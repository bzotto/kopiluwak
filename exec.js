// 
// exec.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 

function KLStackFrame(method) {
	this.method = method;
	this.pc = 0;
	this.localVariables = [];
	this.operandStack = [];
	this.pendingException = null;
	this.completionHandlers = [];
}

// const KLTHREAD_STATE_STOPPED = 0;
const KLTHREAD_STATE_RUNNING = 1;
const KLTHREAD_STATE_ENDED = 2;
const KLTHREAD_STATE_WAITING = 3;

const KLTHREAD_END_REASON_NORMAL = 0;
const KLTHREAD_END_REASON_EXCEPTION = 1;
const KLTHREAD_END_REASON_VM_ERROR = 2;

// each new KLThreadContext bumps this value
let KLNextThreadId = 1; 

function KLIoRequest(fd, len) {
	this.fd = fd;
	this.buffer = [];
	this.len = len;
	this.completedLen = 0;
}

function KLThreadContext(bootstrapMethod, bootstrapArgs) {

	this.stack = [];
	this.threadId = KLNextThreadId++;
	this.javaThreadObj = null;
	this.pendingIo = null;
	this.returnValue = null;
	this.state = KLTHREAD_STATE_RUNNING;
	this.endReason;
	
	this.pushFrame = function(frame) {
		this.stack.unshift(frame);
	}
	
	this.popFrame = function(isAbrupt) {
		let isNormal = !(isAbrupt);
		let outgoingFrame = this.stack.shift();
		if (AccessFlagIsSet(outgoingFrame.method.access, ACC_SYNCHRONIZED)) {
			// XXX: release method monitor.
		}
		if (isNormal) {
			for (let i = 0; i < outgoingFrame.completionHandlers.length; i++) {
				outgoingFrame.completionHandlers[i](outgoingFrame);
			}
		}
		// console.log("--> Exiting " + outgoingFrame.method.class.name + "." + outgoingFrame.method.name);
		return outgoingFrame;
	}
	
	// Exception class name is required; message (JS string) and cause (Throwable jobject) are optional.
	this.throwException = function(exceptionClassName, message, cause) {
		
		// // XXX Debug dump
		// let bt = DebugBacktrace(this);
		// console.log("Exception " + exceptionClassName + ": " + (message?message:"?") + "\n" + bt);
		// ////
				
		let npeClass = ResolveClass(exceptionClassName);
		let e = npeClass.createInstance();
		this.stack[0].pendingException = e; // Not initialized yet but will be when we unwind back to it!
		let initFrame = CreateObjInitFrameForObjectAndDescriptor(e, "(Ljava.lang.String;Ljava.lang.Throwable;)V");
		initFrame.localVariables[0] = e;
		initFrame.localVariables[1] = message ? JavaLangStringObjForJSString(message) : new JNull();
		initFrame.localVariables[2] = cause ? cause : new JNull();
		initFrame.completionHandlers.push(function() { 
			e.state = JOBJ_STATE_INITIALIZED;
		});
		this.pushFrame(initFrame);
	}
	
	this.currentFQMethodName = function() {
		let frame = this.stack[0];
		if (!frame) {
			return null;
		}
		return frame.method.class.name + "." + frame.method.name;
	}
	
	this.currentJavaLangThreadObject = function() {
		if (!this.javaThreadObj) {
			let klclass = ResolveClass("java.lang.Thread");
			this.javaThreadObj = klclass.createInstance();
			this.javaThreadObj.fieldValsByClass["java.lang.Thread"]["name"] = JavaLangStringObjForJSString("Thread-main");
			this.javaThreadObj.fieldValsByClass["java.lang.Thread"]["priority"] = new JInt(1);
			this.javaThreadObj.state = JOBJ_STATE_INITIALIZED;
			
			klclass = ResolveClass("java.lang.ThreadGroup");
			let threadGroup = klclass.createInstance();
			threadGroup.fieldValsByClass["java.lang.ThreadGroup"]["name"] = JavaLangStringObjForJSString("system");
			threadGroup.fieldValsByClass["java.lang.ThreadGroup"]["maxPriority"] = new JInt(10);
			threadGroup.state = JOBJ_STATE_INITIALIZED;
			this.javaThreadObj.fieldValsByClass["java.lang.Thread"]["group"] = threadGroup;				
		}
		return this.javaThreadObj;
	}
	
	this.waitForIoRequest = function(ioRequest) {
		this.pendingIoRequest = ioRequest;
		this.state = KLTHREAD_STATE_WAITING;
	}
	
	this.completeIoRequest = function(ioRequest) {
		if (!this.state == KLTHREAD_STATE_WAITING || 
			this.pendingIoRequest != ioRequest) {
			debugger;
		}
		this.state = KLTHREAD_STATE_RUNNING;
	}	
		
	this.endThreadWithReason = function(reason) {
		this.state = KLTHREAD_STATE_ENDED;
		this.endReason = reason;
	}
		
	// Returns an array of objects with keys className, methodName, fileName, lineNumber 
	this.currentBacktrace = function() {
		let stacktrace = [];
				
		for (let i = 0; i < this.stack.length; i++) {
			let frame = this.stack[i];
	
			// Is there a line number table?
			let lineNumbers = frame.method.lineNumbers;
			let lineNumber = null;
			if (lineNumbers) {
				for (let j = 0; j < lineNumbers.length; j++) {
					let lineEntry = lineNumbers[j];
					if (lineEntry.start_pc > frame.pc) {
						break;
					}
					lineNumber = lineEntry.line_number;
				}
			}
			// Is there a source file name?
			let sourceFileName = frame.method.class.sourceFileName();
	
			let frameEntry = { "className": frame.method.class.name, "methodName": frame.method.name };
			if (sourceFileName) {
				frameEntry["fileName"] = sourceFileName;
			}
			if (lineNumber) {
				frameEntry["lineNumber"] = lineNumber;
			}
			
			stacktrace.push(frameEntry);
		}
		return stacktrace;
	}	
	
	this.exec = function(maxInstructions) {
		
		if (this.state != KLTHREAD_STATE_RUNNING) {
			debugger;
			return;
		}
		this.state = KLTHREAD_STATE_RUNNING;
		if (maxInstructions == undefined) { maxInstructions = 0; }
		let instructionsExecuted = 0;
		
		while (this.stack.length > 0 && (maxInstructions == 0 || instructionsExecuted < maxInstructions)) {
			
			let frame = this.stack[0];
			
			// If there's a pending exception in this frame, look for a handler for it at our current
			// pc and either go there first, or continue down the stack. 
			if (frame.pendingException) {
				let exception = frame.pendingException;
				frame.pendingException = null;
			
				let handlerPC = HandlerPcForException(frame.method.class, frame.pc, exception, frame.method.exceptions);
				if (handlerPC >= 0) {
					// We can handle this one. Blow away the stack and jump to the handler.
					frame.pc = handlerPC;
					frame.operandStack = [exception];
				} else if (this.stack.length > 1) {
					// Nope. Kaboom.
					this.popFrame(true);
					this.stack[0].pendingException = exception;
					continue;
				} else {
					// Nowhere left to throw... 
					let jmessage = exception.fieldValsByClass["java.lang.Throwable"]["detailMessage"];
					let message = (jmessage && !jmessage.isa.isNull()) ? JSStringFromJavaLangStringObj(jmessage) : "(unknown)";
					KLLogInfo("JVM: Java thread terminated due to unhandled exception " + exception.class.name + ":\n\t" + message);
					this.endThreadWithReason(KLTHREAD_END_REASON_EXCEPTION);
					return; 
				}
				
			}
			
			// Are we at the top of a method? If so, a couple special cases are handled now:
			// 1. If this method is part of a class which has not yet been initialized.
			// 2. If this method is native and either has a bound implementation that is not bytecode or has no implementation.
			if (frame.pc == 0) {
				// If we are starting to execute a method contained in a class which is not yet initialized, then 
				// stop and initialize the class if appropriate. We check this first, because we'll need to do this 
				// whether or not the method itself has a native implementation.
				let clinitFrame = CreateClassInitFrameIfNeeded(frame.method.class);
				if (clinitFrame) {
					frame.method.class.state = KLCLASS_STATE_INITIALIZING;
					this.pushFrame(clinitFrame);
					continue;
				}
				
				 // console.log("Entering -> " + this.currentFQMethodName());
				
				if (ShouldBreakOnMethodStart(this)) { debugger; }
				
				if (AccessFlagIsSet(frame.method.access, ACC_SYNCHRONIZED)) {
					// XXX: acquire method monitor.
				}
				
				// If this is a native method, either execute it or if not present, pretend it executed and returned
				// some default value. 
				if ((frame.method.access & ACC_NATIVE) != 0 || frame.method.code == null) { // XXX the code==null condition just helps us with mock objects
					// Check if this is a native method we don't support. If so, log it and return a default value.
					if (frame.method.impl) {
						// Marshal the thread context and arguments for the native implementation. 
						// First argument to an internal implementation is always the KLThreadContext, followed by the 
						// normal Java-land args for the method.
						let implArgs = [this];
						for (let i = 0; i < frame.localVariables.length; i++) {
							implArgs.push(frame.localVariables[i]);
							if (frame.localVariables[i].isa.isCategory2ComputationalType()) {
								i++; // Drop the redundant long/double args from the native calls arg list.
							}
						}						
						let result = frame.method.impl.apply(null, implArgs);
						// If this function changed the thread's state to waiting, by making an IO request, then return immediately
						// leaving the state intact. The I/O's completion will re-enter this native method which should know what to
						// do with the updated situation.
						if (this.state == KLTHREAD_STATE_WAITING) {
							return;
						}
						
						// Skip the epilog logic if the native impl either pushed another frame onto the stack (called another
						// method) or threw an exception. In the former case, we will unwind back to this frame eventually and 
						// re-invoke the same method in full so the impl must be smart enough to know when to return.
						if (this.stack[0] == frame && !frame.pendingException) {
							// Pop this frame and result the result *unless* the native impl threw an exception.
							this.popFrame();
							if (!frame.method.descriptor.returnsVoid()) {
								if (!result || !TypeIsAssignableToType(result.isa, frame.method.descriptor.returnType())) {
									debugger;
								}
								this.stack[0].operandStack.push(result);
							}
						}
					} else {				
						KLLogWarn("Eliding native method " + frame.method.class.name + "." + frame.method.name + " (desc: " + frame.method.descriptor.descriptorString() + ")");
						let nativeFrame = this.popFrame();
						if (!nativeFrame.method.descriptor.returnsVoid()) {
							let returnType = nativeFrame.method.descriptor.returnType();
							let defaultVal = DefaultValueForType(returnType);
							this.stack[0].operandStack.push(defaultVal);
						}
					} 
					continue;
				}	
			}
			
			if (!frame.method.code) { debugger; }
			
			// Verify that the pc is valid. 
			if (frame.pc < 0 || frame.pc >= frame.method.length) {
				KLLogError("JVM: Error: pc " + pc + " invalid for method " + this.currentFQMethodName());
				this.endThreadWithReason(KLTHREAD_END_REASON_VM_ERROR);
				return;
			}
						
			// Fetch and execute the next instruction.
			let opcode = frame.method.code[frame.pc];
			
			// 		    let str = Number(opcode).toString(16);
			// 		    str = str.length == 1 ? "0x0" + str : "0x" + str;
			// console.log("opcode " + str);

			if (ShouldBreakOnInstruction(this)) { debugger; }

			let handler = this.instructionHandlers[opcode];
			if (!handler) {
			    let str = Number(opcode).toString(16);
			    str = str.length == 1 ? "0x0" + str : "0x" + str;
				alert("Unimplemented opcode " + str);
				debugger;			
			}
			handler(frame, opcode, this);
			instructionsExecuted++;
		}
		
		if (this.stack.length == 0) {
			this.endThreadWithReason(KLTHREAD_END_REASON_NORMAL);
		}
	}
	
	//
	// Construction
	// 
	
	if (bootstrapMethod) {
		let baseFrame = new KLStackFrame(bootstrapMethod);
		if (bootstrapArgs) {
			baseFrame.localVariables = bootstrapArgs.slice();
		}
		this.stack.push(baseFrame);
	}
	
	//
	// INSTRUCTION HANDLING
	//
	
	//
	// Exec helper snippets for instruction handling.
	//
		
	function IncrementPC(frame, count) {
		frame.pc = frame.pc + count;
	}
	
	function U8FromInstruction(frame, offset) {
		if (offset == undefined) offset = 1;
		let code = frame.method.code;
		let byte = code[frame.pc + offset];
		return byte;
	}
	
	function S8FromInstruction(frame, offset) {
		if (offset == undefined) offset = 1;
		let code = frame.method.code;
		let byte = code[frame.pc + offset];
		if (byte > 127) { byte -= 256; }
		return byte;
	}
	
	function U16FromInstruction(frame) {
		let code = frame.method.code;
		let high = code[frame.pc + 1];
		let low = code[frame.pc + 2];
		return ((high << 8) | low) >>> 0;
	}
	
	function S16FromInstruction(frame) {
		let code = frame.method.code;
		let high = code[frame.pc + 1];
		let low = code[frame.pc + 2];
		let sign = high & (1 << 7);
		let x = (((high & 0xFF) << 8) | (low & 0xFF));
		let s16 = sign ? (0xFFFF0000 | x) : x;
		return s16;
	}
	
	function S32FromInstruction(frame, offset) {
		let code = frame.method.code;
		let one = code[frame.pc + offset];
		let two = code[frame.pc + offset + 1];
		let three = code[frame.pc + offset + 2];
		let four = code[frame.pc + offset + 3];
		let uval = ((one << 24 ) | (two << 16 ) |  (three << 8 ) | four) >>> 0;
		let sval;
		if (uval > 2147483647) {
			// Surely there's some better way of converting an unsigned value into its
			// signed 32-bit equivalent...??
			sval = uval - 0xFFFFFFFF - 1;
		} else {
			sval = uval;
		}
		return sval;
	}
				
	//
	// Map of opcode values to handler functions. Each handler function takes a thread context,
	// in which the active frame has a pc pointing to the beginning of the relevant instruction
	// within the method's code stream. Handlers do not return a value. They are expected to 
	//
	
	this.instructionHandlers = [];
	this.instructionHandlers[INSTR_aconst_null] = function(frame) {
		frame.operandStack.push(new JNull());
		IncrementPC(frame, 1);
	};
	
	const instr_ldc = function(frame, opcode, thread) {
		let instlen = ((opcode == INSTR_ldc) ? 2 : 3);
		let index;
		if (opcode == INSTR_ldc) {
			index = U8FromInstruction(frame);
		} else {
			index = U16FromInstruction(frame);
		}
		let constref = frame.method.class.constantPool[index];
		let val;
		if (constref.tag == CONSTANT_Class) {
			let className = frame.method.class.classNameFromUtf8Constant(constref.name_index);
			let klclass = ResolveClass(className);
			let jobj = JavaLangClassObjForClass(klclass);
			let initFrame;
			if (jobj.state != JOBJ_STATE_INITIALIZED && (initFrame = CreateObjInitFrameIfNeeded(jobj))) {
				jobj.state = JOBJ_STATE_INITIALIZING;
				initFrame.completionHandlers.push(function() { 
					jobj.state = JOBJ_STATE_INITIALIZED;
				});
				thread.pushFrame(initFrame);
				return;
			} else {
				val = jobj;
			}			
		} else {
			val = frame.method.class.constantValueFromConstantPool(index);
		}
		if (val == undefined) {
			debugger;
		}
		frame.operandStack.push(val);
		IncrementPC(frame, instlen);
	};
	this.instructionHandlers[INSTR_ldc] = instr_ldc;
	this.instructionHandlers[INSTR_ldc_w] = instr_ldc;
	
	this.instructionHandlers[INSTR_ldc2_w] = function(frame, opcode, thread) {
		index = U16FromInstruction(frame);
		let val = frame.method.class.constantValueFromConstantPool(index);
		if (val == undefined) {
			debugger;
		}
		frame.operandStack.push(val);
		IncrementPC(frame, 3);
	}
	
	this.instructionHandlers[INSTR_getstatic] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let fieldRef = frame.method.class.fieldReferenceFromIndex(index);
		let field = ResolveFieldReference(fieldRef);  
		if (!field) {
			thread.throwException("java.lang.IncompatibleClassChangeError", "Cannot resolve static field " + fieldRef.fieldName + " for class " + fieldRef.className);
			return;
		}
		if (field.class.state != KLCLASS_STATE_INITIALIZED && (clinitFrame = CreateClassInitFrameIfNeeded(field.class))) {
			field.class.state = KLCLASS_STATE_INITIALIZING;
			thread.pushFrame(clinitFrame);
		} else {
			let fieldValue = field.class.fieldVals[fieldRef.fieldName];
			if (!fieldValue) {
				debugger;
			}
			frame.operandStack.push(fieldValue);
			IncrementPC(frame, 3);
		}
	}
	
	this.instructionHandlers[INSTR_putstatic] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let fieldRef = frame.method.class.fieldReferenceFromIndex(index);
		let field = ResolveFieldReference(fieldRef);  
		if (!field) {
			thread.throwException("java.lang.IncompatibleClassChangeError", "Cannot resolve static field " + fieldRef.fieldName + " for class " + fieldRef.className);
			return;
		}
		// Is the class in which the field lives intialized yet? 
		if (field.class.state != KLCLASS_STATE_INITIALIZED && (clinitFrame = CreateClassInitFrameIfNeeded(field.class))) {
			field.class.state = KLCLASS_STATE_INITIALIZING;
			thread.pushFrame(clinitFrame);
		} else {
			let fieldValue = frame.operandStack.pop();
			if (!fieldValue) {
				debugger;
			}
			field.class.fieldVals[fieldRef.fieldName] = fieldValue;
			IncrementPC(frame, 3);
		}
	}
	
	this.instructionHandlers[INSTR_getfield] = function(frame) {
		let index = U16FromInstruction(frame);
		let fieldRef = frame.method.class.fieldReferenceFromIndex(index);
		let field = ResolveFieldReference(fieldRef);
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		let value = objectref.fieldValsByClass[field.class.name][field.name];
		if (!value || !TypeIsAssignableToType(value.isa, field.field.type)) {
			// This is an extra check while VM is under development. This break indicates a bug in the VM logic,
			// not a type-unsafe class file.
			debugger;
		}
		frame.operandStack.push(value);
		IncrementPC(frame, 3);
	}
	
	this.instructionHandlers[INSTR_putfield] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let fieldRef = frame.method.class.fieldReferenceFromIndex(index);
		let field = ResolveFieldReference(fieldRef);
		if ((field.access & ACC_STATIC) != 0) {
			thread.throwException("java.lang.IncompatibleClassChangeError");
			return;
		}
		if ((field.access & ACC_FINAL) != 0) {
			if (fieldRef.className != frame.method.class.name || 
				method.name != "<init>") {
				thread.throwException("java.lang.IllegalAccessError");
			}
		}
		let value = frame.operandStack.pop();  
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		if (objectref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		}
		if (!TypeIsAssignableToType(value.isa, field.field.type)) {
			debugger;
		}
		
		objectref.fieldValsByClass[field.class.name][field.name] = value;
		IncrementPC(frame, 3);
	}
	
	const instr_iconst_n = function(frame, opcode) {
		let i = opcode - INSTR_iconst_0;
		frame.operandStack.push(new JInt(i));
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_iconst_m1] = instr_iconst_n;
	this.instructionHandlers[INSTR_iconst_0] = instr_iconst_n;
	this.instructionHandlers[INSTR_iconst_1] = instr_iconst_n;
	this.instructionHandlers[INSTR_iconst_2] = instr_iconst_n;
	this.instructionHandlers[INSTR_iconst_3] = instr_iconst_n;
	this.instructionHandlers[INSTR_iconst_4] = instr_iconst_n;
	this.instructionHandlers[INSTR_iconst_5] = instr_iconst_n;
	
	const instr_lconst_l = function(frame, opcode) {
		let val;
		if (opcode == INSTR_lconst_0) {
			val = KLInt64Zero;
		} else {
			val = new KLInt64([0, 0, 0, 0, 0, 0, 0, 1]);  // == 1
		}
		frame.operandStack.push(new JLong(val));
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_lconst_0] = instr_lconst_l;
	this.instructionHandlers[INSTR_lconst_1] = instr_lconst_l;
	
	const instr_fconst_f = function(frame, opcode) {
		let f = opcode - INSTR_fconst_0;
		frame.operandStack.push(new JFloat(f * 1.0));
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_fconst_0] = instr_fconst_f;
	this.instructionHandlers[INSTR_fconst_1] = instr_fconst_f;
	this.instructionHandlers[INSTR_fconst_2] = instr_fconst_f;
	
	const instr_dconst_d = function(frame, opcode) {
		let d = opcode - INSTR_dconst_0;
		frame.operandStack.push(new JDouble(d * 1.0));
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_dconst_0] = instr_dconst_d;
	this.instructionHandlers[INSTR_dconst_1] = instr_dconst_d;
	
	this.instructionHandlers[INSTR_anewarray] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let constref = frame.method.class.constantPool[index];
		let className = frame.method.class.classNameFromUtf8Constant(constref.name_index);
		let arrayComponentClass = ResolveClass(className);
		let count = frame.operandStack.pop();
		if (!count.isa.isInt()) {
			debugger;
		}
		let intCount = count.val;
		if (intCount < 0) {
			thread.throwException("NegativeArraySizeException");
			return;
		}
		let arrayClass = CreateArrayClassWithAttributes(arrayComponentClass, 1);
		let newarray = new JArray(arrayClass, intCount);
		frame.operandStack.push(newarray);
		IncrementPC(frame, 3);
	}
	
	this.instructionHandlers[INSTR_newarray] = function(frame, opcode, thread) {
		let count = frame.operandStack.pop();
		if (!count.isa.isInt()) {
			debugger;
		}
		let intCount = count.val;
		if (intCount < 0) {
			thread.throwException("NegativeArraySizeException");
			return;
		}
		let atype = U8FromInstruction(frame);
		if (atype < 4 || atype > 11) {
			debugger;
		}
		let jtype = JTypeFromJVMArrayType(atype);
		let arrayClass = CreateArrayClassFromName("[" + jtype.descriptorString());
		let arrayref = new JArray(arrayClass, intCount);
		frame.operandStack.push(arrayref);
		IncrementPC(frame, 2);
	}
	
	this.instructionHandlers[INSTR_new] = function(frame) {
		let index = U16FromInstruction(frame);
		let constref = frame.method.class.constantPool[index];
		let className = frame.method.class.classNameFromUtf8Constant(constref.name_index);
		let klclass = ResolveClass(className);
		let jObj = klclass.createInstance();
		frame.operandStack.push(jObj);
		IncrementPC(frame, 3);
	}
	
	this.instructionHandlers[INSTR_dup] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isCategory1ComputationalType()) {
			debugger;
		}
		frame.operandStack.push(value);
		frame.operandStack.push(value);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_dup_x1] = function(frame) {
		let value1 = frame.operandStack.pop();
		let value2 = frame.operandStack.pop();
		if (!value1.isa.isCategory1ComputationalType()  || !value2.isa.isCategory1ComputationalType()) {
			debugger;
		}
		frame.operandStack.push(value1);
		frame.operandStack.push(value2);
		frame.operandStack.push(value1);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_dup2] = function(frame) {
		let value1 = frame.operandStack.pop();
		if (value1.isa.isCategory2ComputationalType()) {
			frame.operandStack.push(value1);
			frame.operandStack.push(value1);
		} else {
			let value2 = frame.operandStack.pop();
			if (!value2.isa.isCategory1ComputationalType()) {
				debugger;
			}
			frame.operandStack.push(value2);
			frame.operandStack.push(value1);
			frame.operandStack.push(value2);
			frame.operandStack.push(value1);
		}
		IncrementPC(frame, 1);
	}
	
	function PrepareArgumentsByRemovingFromStackForMethod(stack, method) {
		let args = [];
		let narg = method.descriptor.argumentCount();
		// Walk backwards 
		for (let i = (narg-1); i >= 0; i--) {
			let argType = method.descriptor.argumentTypeAtIndex(i);
			if (stack.length < 1) {
				return null;
			}
			let value = stack.pop();
			if (!TypeIsAssignableToType(value.isa, argType)) {
				debugger;
				return null;
			}
			args.unshift(value);
			// Longs and double get added twice, 
			if (argType.isCategory2ComputationalType()) {
				args.unshift(value);
			}
		}
		return args;
	}
	
	this.instructionHandlers[INSTR_invokestatic] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let methodRef = frame.method.class.methodReferenceFromIndex(index);
		let method = ResolveMethodReference(methodRef, null);  // what's the right class param here?
		if (!AccessFlagIsSet(method.access, ACC_STATIC)) {
			thread.throwException("java.lang.IncompatibleClassChangeError", "Expected method " + FullyQualifiedMethodName(method) + " to be static.");
			return;
		}
		if (AccessFlagIsSet(method.access, ACC_NATIVE) && !method.impl) {
			thread.throwException("java.lang.UnsatisfiedLinkError", "Static native method " + FullyQualifiedMethodName(method) + " not implemented.");
			return;
		}
		args = PrepareArgumentsByRemovingFromStackForMethod(frame.operandStack, method);
		if (args == null) {
			debugger;
		}
		let childFrame = new KLStackFrame(method);		
		childFrame.localVariables = args;
		IncrementPC(frame, 3);
		thread.pushFrame(childFrame);
	}
	
	this.instructionHandlers[INSTR_invokevirtual] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let methodRef = frame.method.class.methodReferenceFromIndex(index);
		let resolvedMethod = ResolveMethodReference(methodRef);  
		
		if (IsMethodSignaturePolymorphic(resolvedMethod)) {
			// XXX We don't know how to do this yet.
			debugger;
		}
		
		// Pull args off the stack based on the resolve method's descriptor, even if we end up selecting a 
		// different thing to actually invoke. We need to use *something* to determine the number of args to pull
		// of the stack before we can get to the objectref, which we need to find the chosen method.
		let args = PrepareArgumentsByRemovingFromStackForMethod(frame.operandStack, resolvedMethod);
		if (args == null) { debugger; } 
		
		
		let objectref = frame.operandStack.pop();
		if (objectref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException", "Can't call method " + methodRef.className + "." + methodRef.methodName + " on null object.");
			return;
		}
		args.unshift(objectref);
		
		let classC = objectref.class;
		let method = classC.vtableEntry(resolvedMethod.name, resolvedMethod.descriptor);
		if (!method) {
			let soleMaximallySpecifiedMethod = FindSoleMaximallySpecifiedSuperinterfaceMethod(resolvedMethod.name, resolvedMethod.descriptor);
			if (!AccessFlagIsSet(soleMaximallySpecifiedMethod, ACC_ABSTRACT)) {
				method = soleMaximallySpecifiedMethod;
			}
		}
		if (AccessFlagIsSet(method.access, ACC_ABSTRACT)) {
			thread.throwException("java.lang.AbstractMethodError", "Selected method is abstract and cannot be invoked");
			return;
		}
		if (AccessFlagIsSet(method.access, ACC_NATIVE) && !method.impl) {
			thread.throwException("java.lang.UnsatisfiedLinkError", "Native method " + FullyQualifiedMethodName(method) + " not implemented.");
			return;	
		}		
		
		let childFrame = new KLStackFrame(method);		
		childFrame.localVariables = args;
		IncrementPC(frame, 3);
		thread.pushFrame(childFrame);
	}
	
	this.instructionHandlers[INSTR_invokespecial] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let methodRef = frame.method.class.methodReferenceFromIndex(index);
		let resolvedMethod = ResolveMethodReference(methodRef);  
		
		// if (AccessFlagIsSet(method.access, ACC_PROTECTED) ... 
			
		let classC; 
		if (resolvedMethod.name != "<init>" && 
			!resolvedMethod.class.isInterface() && 
			IsClassASubclassOf(frame.method.class.name, resolvedMethod.class.name) &&
			AccessFlagIsSet(frame.method.class.accessFlags, ACC_SUPER)) {
			classC = frame.method.class.superclass;
		} else {
			classC = resolvedMethod.class;
		}
		
		let method = classC.vtableEntry(resolvedMethod.name, resolvedMethod.descriptor);
		if (!method) {
			let objectClass = ResolveClass("java.lang.Object");
			let objectMethod = objectClass.vtableEntry(resolvedMethod.name, resolvedMethod.descriptor);
			if (classC.isInterface() && objectMethod && AccessFlagIsSet(objectMethod.access, ACC_PUBLIC)) {
				method = objectMethod;
			}
		}
		
		if (!method) {
			let soleMaximallySpecifiedMethod = FindSoleMaximallySpecifiedSuperinterfaceMethod(resolvedMethod.name, resolvedMethod.descriptor);
			if (!AccessFlagIsSet(soleMaximallySpecifiedMethod, ACC_ABSTRACT)) {
				method = soleMaximallySpecifiedMethod;
			}
		}
		
		if (AccessFlagIsSet(method.access, ACC_ABSTRACT)) {
			thread.throwException("java.lang.AbstractMethodError", "Selected method is abstract and cannot be invoked");
			return;
		}
		if (AccessFlagIsSet(method.access, ACC_NATIVE) && !method.impl) {
			thread.throwException("java.lang.UnsatisfiedLinkError", "Native method " + FullyQualifiedMethodName(method) + " not implemented.");
			return;	
		}		
			
		let args = PrepareArgumentsByRemovingFromStackForMethod(frame.operandStack, method);
		if (args == null) { debugger; } 
		
		let objectref = frame.operandStack.pop();
		if (objectref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException", "Can't call method " + methodRef.className + "." + methodRef.methodName + " on null object.");
			return;
		}
		args.unshift(objectref);
		
		let childFrame = new KLStackFrame(method);		
		childFrame.localVariables = args;
		IncrementPC(frame, 3);
		thread.pushFrame(childFrame);
	}
		
	this.instructionHandlers[INSTR_invokeinterface] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let count = U8FromInstruction(frame, 3);
		let methodRef = frame.method.class.methodReferenceFromIndex(index);
		if (!methodRef.isInterface) {
			debugger;
		}
		let resolvedMethod = ResolveMethodReference(methodRef);
		if (!resolvedMethod) {
			thread.throwException("java.lang.AbstractMethodError");
			return;
		}
		if (resolvedMethod.name == "<init>" || resolvedMethod.name == "<clinit>") {
			debugger;
		}
		if (count == 0) {
			debugger;
		}
		let args = PrepareArgumentsByRemovingFromStackForMethod(frame.operandStack, resolvedMethod);
		if (args == null) {
			debugger; // static type safety error or internal stack management error.
		}
		let objectref = frame.operandStack.pop();
		if (objectref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		}
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		let classC = objectref.class;
		let method = classC.vtableEntry(resolvedMethod.name, resolvedMethod.descriptor);
		if (!method) {
			method = FindSoleMaximallySpecifiedSuperinterfaceMethod(resolvedMethod.name, resolvedMethod.descriptor);
		}
		if (!classC.implementsInterface(methodRef.className)) {
			thread.throwException("java.lang.IncompatibleClassChangeError");
			return;
		}		
		if (!AccessFlagIsSet(method.access, ACC_PUBLIC)) {
			thread.throwException("java.lang.IllegalAccessError");
			return;	
		}
		if (AccessFlagIsSet(method.access, ACC_ABSTRACT)) {
			thread.throwException("java.lang.AbstractMethodError");
			return;	
		}
		if (AccessFlagIsSet(method.access, ACC_NATIVE) && !method.impl) {
			thread.throwException("java.lang.UnsatisfiedLinkError", "Interface native method " + FullyQualifiedMethodName(method) + " not implemented.");
			return;	
		}
		args.unshift(objectref);
		let childFrame = new KLStackFrame(method);		
		childFrame.localVariables = args;
		IncrementPC(frame, 5);
		thread.pushFrame(childFrame);
	}
	
	const instr_aload_n = function(frame, opcode) {
		let n = opcode - INSTR_aload_0;
		let objectref = frame.localVariables[n];
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		frame.operandStack.push(objectref);
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_aload_0] = instr_aload_n;
	this.instructionHandlers[INSTR_aload_1] = instr_aload_n;
	this.instructionHandlers[INSTR_aload_2] = instr_aload_n;
	this.instructionHandlers[INSTR_aload_3] = instr_aload_n;
	
	this.instructionHandlers[INSTR_return] = function(frame, opcode, thread) {
		if (!frame.method.descriptor.returnsVoid()) {
			debugger;
		}		
		thread.popFrame();		
	}
	
	this.instructionHandlers[INSTR_ireturn] = function(frame, opcode, thread) {
		let returnType = frame.method.descriptor.returnType();
		if (!returnType.isBoolean() && !returnType.isByte() && !returnType.isShort() && !returnType.isChar() && !returnType.isInt()) {
			debugger;
		}
		let value = frame.operandStack.pop();
		if (!value || !TypeIsAssignableToType(value.isa, returnType)) {
			debugger;
		}
		thread.popFrame();
		if (thread.stack.length > 0) {
			thread.stack[0].operandStack.push(value);
		} else {
			thread.returnValue = value;
		}
	}
	
	this.instructionHandlers[INSTR_areturn] = function(frame, opcode, thread) {
		let objectref = frame.operandStack.pop();
		if (!objectref || !objectref.isa.isReferenceType() || !TypeIsAssignableToType(objectref.isa, frame.method.descriptor.returnType())) {
			debugger;
		}
		thread.popFrame();
		if (thread.stack.length > 0) {
			thread.stack[0].operandStack.push(objectref);
		} else {
			thread.returnValue = objectref;
		}
	}
	
	this.instructionHandlers[INSTR_freturn] = function(frame, opcode, thread) {
		let value = frame.operandStack.pop();
		if (!value || !value.isa.isFloat() || !frame.method.descriptor.returnType() || !frame.method.descriptor.returnType().isFloat())  {
			debugger;
		}
		thread.popFrame();
		if (thread.stack.length > 0) {
			thread.stack[0].operandStack.push(value);
		} else {
			thread.returnValue = value;
		}
	}
	
	this.instructionHandlers[INSTR_dreturn] = function(frame, opcode, thread) {
		let value = frame.operandStack.pop();
		if (!value || !value.isa.isDouble() || !frame.method.descriptor.returnType() || !frame.method.descriptor.returnType().isDouble())  {
			debugger;
		}
		thread.popFrame();
		if (thread.stack.length > 0) {
			thread.stack[0].operandStack.push(value);
		} else {
			thread.returnValue = value;
		}
	}
	
	this.instructionHandlers[INSTR_lreturn] = function(frame, opcode, thread) {
		let value = frame.operandStack.pop();
		if (!value || !value.isa.isLong() || !frame.method.descriptor.returnType() || !frame.method.descriptor.returnType().isLong())  {
			debugger;
		}
		thread.popFrame();
		if (thread.stack.length > 0) {
			thread.stack[0].operandStack.push(value);
		} else {
			thread.returnValue = value;
		}
	}
	
	const instr_iload_n = function(frame, opcode) {
		let n = opcode - INSTR_iload_0;
		let value = frame.localVariables[n];
		if (!value.isa.isInt()) {
			debugger;
		}
		frame.operandStack.push(value);
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_iload_0] = instr_iload_n;
	this.instructionHandlers[INSTR_iload_1] = instr_iload_n;
	this.instructionHandlers[INSTR_iload_2] = instr_iload_n;
	this.instructionHandlers[INSTR_iload_3] = instr_iload_n;
	
	const instr_lload_n = function(frame, opcode) {
		let n = opcode - INSTR_lload_0;
		let value = frame.localVariables[n];
		if (!value.isa.isLong()) {
			debugger;
		}
		frame.operandStack.push(value);
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_lload_0] = instr_lload_n;
	this.instructionHandlers[INSTR_lload_1] = instr_lload_n;
	this.instructionHandlers[INSTR_lload_2] = instr_lload_n;
	this.instructionHandlers[INSTR_lload_3] = instr_lload_n;
	
	const instr_fload_n = function(frame, opcode) {
		let n = opcode - INSTR_fload_0;
		let value = frame.localVariables[n];
		if (!value.isa.isFloat()) {
			debugger;
		}
		frame.operandStack.push(value);
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_fload_0] = instr_fload_n;
	this.instructionHandlers[INSTR_fload_1] = instr_fload_n;
	this.instructionHandlers[INSTR_fload_2] = instr_fload_n;
	this.instructionHandlers[INSTR_fload_3] = instr_fload_n;
	
	this.instructionHandlers[INSTR_arraylength] = function(frame, opcode, thread) {
		let arrayref = frame.operandStack.pop();
		if (arrayref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		}
		if (!arrayref.isa.isArray()) {
			debugger;
		}
		let length = new JInt(arrayref.count);		
		frame.operandStack.push(length);
		IncrementPC(frame, 1);
	}
	
	const instr_if_cond = function(frame, opcode) {
		let value = frame.operandStack.pop();
		if (!value) {
			debugger;
		}
		if (!value.isa.isInt()) {
			debugger;
		}
		let doBranch = false;
		let intVal = value.val;
		switch (opcode) {
		case INSTR_ifeq: 
			doBranch = (intVal == 0);
			break;
		case INSTR_ifne:
			doBranch = (intVal != 0);
			break;
		case INSTR_iflt:
			doBranch = (intVal < 0);
			break;
		case INSTR_ifge:
			doBranch = (intVal >= 0);
			break;
		case INSTR_ifgt:
			doBranch = (intVal > 0);
			break;
		case INSTR_ifle:
			doBranch = (intVal <= 0);
			break;
		}
		if (doBranch) {
			let offset = S16FromInstruction(frame);
			IncrementPC(frame, offset);
		} else {
			IncrementPC(frame, 3);
		}
	}
	this.instructionHandlers[INSTR_ifeq] = instr_if_cond;
	this.instructionHandlers[INSTR_ifne] = instr_if_cond;
	this.instructionHandlers[INSTR_iflt] = instr_if_cond;
	this.instructionHandlers[INSTR_ifge] = instr_if_cond;
	this.instructionHandlers[INSTR_ifgt] = instr_if_cond;
	this.instructionHandlers[INSTR_ifle] = instr_if_cond;
	
	const instr_if_icmp_cond = function(frame, opcode, thread) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}
		let doBranch = false;
		let intVal1 = value1.val;
		let intVal2 = value2.val;
		switch (opcode) {
		case INSTR_if_icmpeq:
			doBranch = (intVal1 == intVal2);
			break;
		case INSTR_if_icmpne:
			doBranch = (intVal1 != intVal2);
			break;
		case INSTR_if_icmplt:
			doBranch = (intVal1 < intVal2);
			break;
		case INSTR_if_icmpge:
			doBranch = (intVal1 >= intVal2);
			break;
		case INSTR_if_icmpgt:
			doBranch = (intVal1 > intVal2);
			break;
		case INSTR_if_icmple:
			doBranch = (intVal1 <= intVal2);
			break;
		}
		if (doBranch) {
			let offset = S16FromInstruction(frame);
			IncrementPC(frame, offset);
		} else {
			IncrementPC(frame, 3);
		}
	}
	this.instructionHandlers[INSTR_if_icmpeq] = instr_if_icmp_cond;
	this.instructionHandlers[INSTR_if_icmpne] = instr_if_icmp_cond;
	this.instructionHandlers[INSTR_if_icmplt] = instr_if_icmp_cond;
	this.instructionHandlers[INSTR_if_icmpge] = instr_if_icmp_cond;
	this.instructionHandlers[INSTR_if_icmpgt] = instr_if_icmp_cond;
	this.instructionHandlers[INSTR_if_icmple] = instr_if_icmp_cond;
	
	const instr_fcmp_op = function(frame, opcode) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isFloat() || !value2.isa.isFloat()) {
			debugger;
		}
		let floatVal1 = value1.val;
		let floatVal2 = value2.val;
		if (value1.isNaN() || value2.isNaN()) {
			if (opcode == INSTR_fcmpl) {
				frame.operandStack.push(new JInt(-1));
			} else {
				frame.operandStack.push(new JInt(1));
			}
		} else if (floatVal1 > floatVal2) {
			frame.operandStack.push(new JInt(1));
		} else if (floatVal1 == floatVal2) {
			frame.operandStack.push(new JInt(0));
		} else if (floatVal1 < floatVal2) {
			frame.operandStack.push(new JInt(-1));
		}
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_fcmpg] = instr_fcmp_op;
	this.instructionHandlers[INSTR_fcmpl] = instr_fcmp_op;
	
	this.instructionHandlers[INSTR_lcmp] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isLong()) {
			debugger;
		}
		let diff = KLInt64Subtract(value1.val, value2.val);
		let result;
		if (diff.isNegative()) {
			result = new JInt(-1);
		} else if (diff.isZero()) {
			result = new JInt(0);
		} else {
			result = new JInt(1);
		}
		frame.operandStack.push(result);
		IncrementPC(frame, 1);	
	}

	this.instructionHandlers[INSTR_isub] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}
		let result = new JInt(value1.val - value2.val);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	const instr_astore_n = function(frame, opcode) {
		let n = opcode - INSTR_astore_0;
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType() && !objectref.isa.isReturnAddress()) {
			debugger;
		}
		frame.localVariables[n] = objectref;
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_astore_0] = instr_astore_n;
	this.instructionHandlers[INSTR_astore_1] = instr_astore_n;
	this.instructionHandlers[INSTR_astore_2] = instr_astore_n;
	this.instructionHandlers[INSTR_astore_3] = instr_astore_n;
	
	this.instructionHandlers[INSTR_ifnonnull] = function(frame) {
		let offset = S16FromInstruction(frame);
		let value = frame.operandStack.pop();
		if (!value.isa.isReferenceType()) {
			debugger;
		}
		if (!value.isa.isNull()) {
			IncrementPC(frame, offset);
		} else {
			IncrementPC(frame, 3);
		}
	}
	
	this.instructionHandlers[INSTR_ifnull] = function(frame) {
		let offset = S16FromInstruction(frame);
		let value = frame.operandStack.pop();
		if (!value.isa.isReferenceType()) {
			debugger;
		}
		if (value.isa.isNull()) {
			IncrementPC(frame, offset);
		} else {
			IncrementPC(frame, 3);
		}
	}
	
	this.instructionHandlers[INSTR_goto] = function(frame) {
		let offset = S16FromInstruction(frame);
		IncrementPC(frame, offset);
	}
		
	const instr_xstore = function(frame, opcode) {
		let index = U8FromInstruction(frame);
		let valueOrObjectref = frame.operandStack.pop();
		if ((opcode == INSTR_istore && !valueOrObjectref.isa.isInt()) || 
		    (opcode == INSTR_lstore && !valueOrObjectref.isa.isLong()) ||
			(opcode == INSTR_fstore && !valueOrObjectref.isa.isFloat()) ||
			(opcode == INSTR_dstore && !valueOrObjectref.isa.isDouble()) ||
			(opcode == INSTR_astore && !(valueOrObjectref.isa.isReferenceType() || valueOrObjectref.isa.isReturnAddress()))) {
				debugger;
		}
		
		frame.localVariables[index] = valueOrObjectref;
		if (opcode == INSTR_lstore || opcode == INSTR_dstore) {
			frame.localVariables[index+1] = valueOrObjectref;
		}
		IncrementPC(frame, 2);
	}
	this.instructionHandlers[INSTR_istore] = instr_xstore;
	this.instructionHandlers[INSTR_lstore] = instr_xstore;
	this.instructionHandlers[INSTR_fstore] = instr_xstore;
	this.instructionHandlers[INSTR_dstore] = instr_xstore;
	this.instructionHandlers[INSTR_astore] = instr_xstore;
		
	const instr_xload = function(frame, opcode) {
		let index = U8FromInstruction(frame);
		let valueOrObjectref = frame.localVariables[index];
		if ((opcode == INSTR_iload && !valueOrObjectref.isa.isInt()) || 
		    (opcode == INSTR_lload && !valueOrObjectref.isa.isLong()) ||
			(opcode == INSTR_fload && !valueOrObjectref.isa.isFloat()) ||
			(opcode == INSTR_dload && !valueOrObjectref.isa.isDouble()) ||
			(opcode == INSTR_aload && !valueOrObjectref.isa.isReferenceType())) {
				debugger;
		}
		frame.operandStack.push(valueOrObjectref);
		IncrementPC(frame, 2);
	}
	this.instructionHandlers[INSTR_iload] = instr_xload;
	this.instructionHandlers[INSTR_lload] = instr_xload;
	this.instructionHandlers[INSTR_fload] = instr_xload;
	this.instructionHandlers[INSTR_dload] = instr_xload;
	this.instructionHandlers[INSTR_aload] = instr_xload;
	
	this.instructionHandlers[INSTR_iinc] = function(frame) {
		let index = U8FromInstruction(frame, 1);
		let cnst = S8FromInstruction(frame, 2);
		let value = frame.localVariables[index];
		if (!value.isa.isInt()) {
			debugger;
		}
		let intVal = value.val + cnst;
		frame.localVariables[index] = new JInt(intVal);
		IncrementPC(frame, 3);
	}
	
	const instr_ixload = function(frame, opcode, thread) {
		let index = frame.operandStack.pop();
		let arrayref = frame.operandStack.pop();
		// Static and dynamic type checks, ordered so they can each be effective in turn. 
		if (arrayref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		}
		if (!index.isa.isInt() || !arrayref.isa.isArray()) {
			debugger;
		}
		if ((opcode == INSTR_iaload && !arrayref.containsType.isInt()) ||
			(opcode == INSTR_laload && !arrayref.containsType.isLong()) ||
			(opcode == INSTR_faload && !arrayref.containsType.isFloat()) ||
			(opcode == INSTR_daload && !arrayref.containsType.isDouble()) ||
			(opcode == INSTR_aaload && !arrayref.containsType.isReferenceType()) ||
			(opcode == INSTR_baload && !(arrayref.containsType.isByte() || arrayref.containsType.isBoolean())) ||
			(opcode == INSTR_caload && !arrayref.containsType.isChar()) ||
			(opcode == INSTR_saload && !arrayref.containsType.isShort())) {
			debugger;
		}
		let indexVal = index.val;
		if (indexVal < 0 || indexVal >= arrayref.count) {
			thread.throwException("java.lang.ArrayIndexOutOfBoundsException");
			return;
		}
		let valueOrObjectref = arrayref.elements[indexVal];
		// byte/char/short gets sign-extended to an int value.
		switch (opcode) {
		case INSTR_baload:
			{
				let sign = valueOrObjectref.val & 0x80;
				if (sign) {
					valueOrObjectref = new JInt(0xFFFFFF00 | valueOrObjectref.val);
				} else {
					valueOrObjectref = new JInt(valueOrObjectref.val);
				}
				break;				
			}
		case INSTR_caload:
			{
				valueOrObjectref = new JInt(valueOrObjectref.val & 0xFFFF);
				break;
			}
		case INSTR_saload:
			{
				let sign = valueOrObjectref.val & 0x8000;
				if (sign) {
					valueOrObjectref = new JInt(0xFFFF0000 | valueOrObjectref.val);
				} else {
					valueOrObjectref = new JInt(valueOrObjectref.val);
				}
				break;				
			}
		}
		frame.operandStack.push(valueOrObjectref);
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_iaload] = instr_ixload;
	this.instructionHandlers[INSTR_laload] = instr_ixload;
	this.instructionHandlers[INSTR_faload] = instr_ixload;
	this.instructionHandlers[INSTR_daload] = instr_ixload;
	this.instructionHandlers[INSTR_aaload] = instr_ixload;
	this.instructionHandlers[INSTR_baload] = instr_ixload;
	this.instructionHandlers[INSTR_caload] = instr_ixload;
	this.instructionHandlers[INSTR_saload] = instr_ixload;	
	
	this.instructionHandlers[INSTR_bipush] = function(frame) {
		let byte = S8FromInstruction(frame);
		let value = new JInt(byte);
		frame.operandStack.push(value);
		IncrementPC(frame, 2);
	}
	
	this.instructionHandlers[INSTR_sipush] = function(frame) {
		let short = S16FromInstruction(frame);
		let value = new JInt(short);
		frame.operandStack.push(value);
		IncrementPC(frame, 3);
	}	
	
	this.instructionHandlers[INSTR_iushr] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}
		let intVal1 = value1.val;
		let intVal2 = value2.val;
		let s = intVal2 & 0x1F;
		let intResult;
		if (intVal1 > 0) {
			intResult = intVal1 >> s;
		} else {
			intResult = (intVal1 >> s) + (2 << ~s);
		}
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_ishr] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		let intVal1 = value1.val;
		let intVal2 = value2.val;
		let s = intVal2 & 0x1F;
		let intResult = intVal1 >> s;   // the JS >> operator does sign extension as ishr requires
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_ishl] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		let intVal1 = value1.val;
		let intVal2 = value2.val;
		let s = intVal2 & 0x1F;
		let intResult = intVal1 << s;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_i2b] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isInt()) {
			debugger;
		}
		let intResult = value.val & 0x000000FF;
		if ((intResult & 0x00000080) > 0) {
			// sign extend to int size
			intResult = intResult | 0xFFFFFF00;
		}
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_i2c] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isInt()) {
			debugger;
		}
		let intResult = value.val & 0x0000FFFF;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_i2f] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isInt()) {
			debugger;
		}
		let result = new JFloat(value.val);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_i2d] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isInt()) {
			debugger;
		}
		let result = new JDouble(value.val);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_f2i] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isFloat()) {
			debugger;
		}
		let intResult;
		if (value.isNaN()) {
			intResult = 0;
		} else {
			intResult = Math.trunc(value.val);
		}
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);		
	}
		
	this.instructionHandlers[INSTR_d2i] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isDouble()) {
			debugger;
		}
		let intResult;
		if (value.isNaN()) {
			intResult = 0;
		} else {
			intResult = Math.trunc(value.val);
		}
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);		
	}
		
	const instr_l2_floating = function(frame, opcode) {
		let value = frame.operandStack.pop();
		if (!value.isa.isLong()) {
			debugger;
		}
		let int64 = value.val;
		let doubleResult = 0.0;
		// This algorithm doens't handle zero automaticaly, but it's trivial to assign directly.
		if (!int64.isZero()) { 
			let sign = int64.isNegative();
			// Turn the int into its positive version once we know the required sign.
			if (sign) {
				// Special case for int64-min which will overflow if negated. 
				if (int64.isEqualTo(KLInt64MinValue)) {
					int64 = KLInt64Add(int64, KLInt64One);
				}
				int64 = KLInt64Negated(int64);
			}
			let leadingZeroes = int64.countLeadingZeroes();
			let exponent = (63 - leadingZeroes) + 1023;			
			let intermediate = KLInt64LogicalShiftLeft(int64, leadingZeroes + 1);
			let significand = KLInt64ShiftRight(intermediate, 12);
			let noSignResult = KLInt64BitwiseOr(significand, KLInt64LogicalShiftLeft(KLInt64FromNumber(exponent), 52));
			let finalResult = sign ? KLInt64BitwiseOr(noSignResult, KLInt64MinValue) : noSignResult; // min value has only the sign bit on.
			doubleResult = fromIEEE754Double(finalResult.asBytes());
		}
		let result;
		if (opcode == INSTR_l2f) {
			let floatResult = Math.fround(doubleResult);
			result = new JFloat(floatResult);
		} else {
			result = new JDouble(doubleResult);
		}
		frame.operandStack.push(result);
		IncrementPC(frame, 1);		
	}
	this.instructionHandlers[INSTR_l2f] = instr_l2_floating;
	this.instructionHandlers[INSTR_l2d] = instr_l2_floating;
	
	this.instructionHandlers[INSTR_d2l] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isDouble()) {
			debugger;
		}
		let int64 = KLInt64FromNumber(value.val);
		let result = new JLong(int64);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);		
	}
	
	this.instructionHandlers[INSTR_f2l] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isFloat()) {
			debugger;
		}
		let int64 = KLInt64FromNumber(value.val);
		let result = new JLong(int64);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);		
	}
	
	this.instructionHandlers[INSTR_f2d] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isFloat()) {
			debugger;
		}
		let doubleVal = value.val
		let result = new JDouble(doubleVal);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);		
	}
	
	const instr_int_astore = function(frame, opcode, thread) {
		let value = frame.operandStack.pop();
		let index = frame.operandStack.pop();
		let arrayref = frame.operandStack.pop();
		if (arrayref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		}
		if (!value.isa.isInt() || !index.isa.isInt() || !arrayref.isa.isArray()) {
			debugger;
		}
		if ((opcode == INSTR_iastore && !arrayref.containsType.isInt()) ||
			(opcode == INSTR_bastore && !(arrayref.containsType.isByte() || arrayref.containsType.isBoolean())) ||
			(opcode == INSTR_castore && !arrayref.containsType.isChar()) ||
			(opcode == INSTR_sastore && !arrayref.containsType.isShort())) {
			debugger;
		}
		let indexVal = index.val;
		if (indexVal < 0 || indexVal >= arrayref.count) {
			thread.throwException("java.lang.ArrayIndexOutOfBoundsException");
			return;
		}
		switch (opcode) {
		case INSTR_iastore:
			arrayref.elements[indexVal] = value;
			break;
		case INSTR_bastore:
			arrayref.elements[indexVal] = new JByte(value.val & 0xFF);
			break;
		case INSTR_castore:
			arrayref.elements[indexVal] = new JChar(value.val & 0xFFFF);
			break;
		case INSTR_sastore:
			arrayref.elements[indexVal] = new JShort(value.val & 0xFFFF);
			break;
		}
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_iastore] = instr_int_astore;
	this.instructionHandlers[INSTR_bastore] = instr_int_astore;
	this.instructionHandlers[INSTR_castore] = instr_int_astore;
	this.instructionHandlers[INSTR_sastore] = instr_int_astore;
	
	this.instructionHandlers[INSTR_aastore] = function(frame, opcode, thread) {
		let value = frame.operandStack.pop();
		let index = frame.operandStack.pop();
		let arrayref = frame.operandStack.pop();
		if (arrayref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		}
		if (!value.isa.isReferenceType() || !index.isa.isInt() || !arrayref.isa.isArray() || !arrayref.containsType.isReferenceType()) {
			debugger;
		}
		if (!TypeIsAssignableToType(value.isa, arrayref.containsType)) {
			debugger;
		}
		let indexVal = index.val;
		if (indexVal < 0 || indexVal >= arrayref.count) {
			thread.throwException("java.lang.ArrayIndexOutOfBoundsException");
			return;
		}
		arrayref.elements[indexVal] = value;
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_pop] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isCategory1ComputationalType()) {
			debugger;
		}
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_pop2] = function(frame) {
		let value1 = frame.operandStack.pop();
		if (value1.isa.isCategory1ComputationalType()) {
			let value2 = frame.operandStack.pop();
		} else {
			// nothing
		}
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_idiv] = function(frame, opcode, thread) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();	
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}				
		if (value2.val == 0) {
			thread.throwException("java.lang.ArithmeticException");
			return;
		}
		let div = value1.val / value2.val;
		let intResult = Math.trunc(div);
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_iadd] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}				
		// XXX This must be constrained to the 32-bit value range and overflow correctly.
		let intResult = value1.val + value2.val;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_imul] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}				
		let intResult = (value1.val * value2.val) & 0xFFFFFFFF;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_irem] = function(frame, opcode, thread) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}
		let intVal1 = value1.val;				
		let intVal2 = value2.val;				
		if (intVal2 == 0) {
			thread.throwException("java.lang.ArithmeticException");
			return;
		}
		let intResult = intVal1 - (Math.trunc(intVal1 / intVal2)) * intVal2;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_ineg] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isInt()) {
			debugger;
		}
		let intResult = ((~value.val) + 1) & 0xFFFFFFFF;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_fadd] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isFloat() || !value2.isa.isFloat()) {
			debugger;
		}				
		let floatResult = value1.val + value2.val;
		let result = new JFloat(floatResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_fmul] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isFloat() || !value2.isa.isFloat()) {
			debugger;
		}				
		let floatResult = value1.val * value2.val;
		let result = new JFloat(floatResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_fdiv] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isFloat() || !value2.isa.isFloat()) {
			debugger;
		}				
		let floatResult = value1.val / value2.val;
		let result = new JFloat(floatResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_dadd] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isDouble() || !value2.isa.isDouble()) {
			debugger;
		}				
		let doubleResult = value1.val / value2.val;
		let result = new JDouble(doubleResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_dmul] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isDouble() || !value2.isa.isDouble()) {
			debugger;
		}				
		let doubleResult = value1.val * value2.val;
		let result = new JDouble(doubleResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	const instr_istore_n = function(frame, opcode) {
		let index = opcode - INSTR_istore_0;
		let value = frame.operandStack.pop();
		if (!value.isa.isInt()) {
			debugger;
		}
		frame.localVariables[index] = value;
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_istore_0] = instr_istore_n;
	this.instructionHandlers[INSTR_istore_1] = instr_istore_n;
	this.instructionHandlers[INSTR_istore_2] = instr_istore_n;
	this.instructionHandlers[INSTR_istore_3] = instr_istore_n;
	
	const instr_lstore_n = function(frame, opcode) {
		let index = opcode - INSTR_lstore_0;
		let value = frame.operandStack.pop();
		if (!value.isa.isLong()) {
			debugger;
		}
		frame.localVariables[index] = value;
		frame.localVariables[index+1] = value;
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_lstore_0] = instr_lstore_n;
	this.instructionHandlers[INSTR_lstore_1] = instr_lstore_n;
	this.instructionHandlers[INSTR_lstore_2] = instr_lstore_n;
	this.instructionHandlers[INSTR_lstore_3] = instr_lstore_n;

	this.instructionHandlers[INSTR_ixor] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}				
		let intResult = value1.val ^ value2.val;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_iand] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}				
		let intResult = value1.val & value2.val;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_ior] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isInt() || !value2.isa.isInt()) {
			debugger;
		}				
		let intResult = value1.val | value2.val;
		let result = new JInt(intResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	// Core determination function used by both checkcast and instanceof, sometimes recursively. 
	function DetermineIfIsInstanceOf(S, T) {
		let isInstanceOf = false;
		
		if (S.isOrdinaryClass()) {
			if (T.isOrdinaryClass()) {
				if ((S.name == T.name) || IsClassASubclassOf(S.name, T.name)) {
					return true;
				}
			} else if (T.isInterface()) {
				if (S.implementsInterface(T.name)) {
					return true;
				}
			}
		} else if (S.isInterface()) {
			if (T.isOrdinaryClass()) {
				if (T.name == "java.lang.Object") {
					return true;
				} 
			} else if (T.isInterface()) {
				if ((S.name == T.name) || IsClassASubclassOf(S.name, T.name)) {
					return true;
				}
			}
		} else if (S.isArray()) {
			if (T.isOrdinaryClass()) {
				if (T.name == "java.lang.Object") {
					return true;
				} 
			} else if (T.isInterface()) {
				if (S.implementsInterface(T.name)) {
					return true;
				}
			} else if (T.isArray()) {
				let SC = S.arrayComponentType();
				let TC = T.arrayComponentType();
				if (SC.isPrimitiveType() && TC.isPrimitiveType() && SC.isIdenticalTo(TC)) {
					return true;
				} else if (SC.isReferenceType() && TC.isReferenceType()) {
					// Get the descriptor string from each component type, resolve them each, and then
					// call this deteminor recursively. 
					let scClass = ResolveClass(SC.descriptorString());
					let tcClass = ResolveClass(TC.descriptorString());
					return DetermineIfIsInstanceOf(scClass, tcClass);	
				}
			}
		}
		return false;
	}

	this.instructionHandlers[INSTR_checkcast] = function(frame, opcode, thread) {
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		let castOK = false;
		if (objectref.isa.isNull()) {
			castOK = true;
		} else {
			let index = U16FromInstruction(frame);
			let classref = frame.method.class.constantPool[index];
			if (classref.tag != CONSTANT_Class) {
				debugger;
			}
			let S = objectref.class;
			let className = frame.method.class.classNameFromUtf8Constant(classref.name_index); 
			let T = ResolveClass(className);
			castOK = DetermineIfIsInstanceOf(S, T);
		}
		if (!castOK) {
			thread.throwException("java.lang.ClassCastException");
			return;
		}
		frame.operandStack.push(objectref);
		IncrementPC(frame, 3);
	}
		
	this.instructionHandlers[INSTR_instanceof] = function(frame) {
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		let intResult = 0;
		if (objectref.isa.isNull()) {
			intResult = 0;
		} else {
			let index = U16FromInstruction(frame);
			let classref = frame.method.class.constantPool[index];
			if (classref.tag != CONSTANT_Class) {
				debugger;
			}
			let S = objectref.class;
			let className = frame.method.class.classNameFromUtf8Constant(classref.name_index); 
			let T = ResolveClass(className);
			if (DetermineIfIsInstanceOf(S, T)) {
				intResult = 1;
			}
		}
		frame.operandStack.push(new JInt(intResult));
		IncrementPC(frame, 3);
	}
	
	const instr_if_acmp_cond = function(frame, opcode, thread) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isReferenceType() || !value2.isa.isReferenceType()) {
			debugger;
		}				
		// This is essentially strict pointer equality. Is this the right way to check for "equals" here? 
		if ((opcode == INSTR_if_acmpeq && value1 == value2) ||
			(opcode == INSTR_if_acmpne && value1 != value2)) {
			let offset = S16FromInstruction(frame);
			IncrementPC(frame, offset);
		} else {
			IncrementPC(frame, 3);
		}
	}
	this.instructionHandlers[INSTR_if_acmpeq] = instr_if_acmp_cond;
	this.instructionHandlers[INSTR_if_acmpne] = instr_if_acmp_cond;
	
	this.instructionHandlers[INSTR_athrow] = function(frame, opcode, thread) {
		let objectref = frame.operandStack.pop();
		if (objectref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		} 
		if (!ObjectIsA(objectref, "java.lang.Throwable")) {
			debugger;
		}
				
		// N.B. The pc doesn't change here, so the exception handler lookup will happen relative
		// to this instruction.
		frame.pendingException = objectref;
	}
	
	this.instructionHandlers[INSTR_lshl] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isInt()) {
			debugger;
		}
		let s = value2.val & 0x3F;
		let int64 = value1.val;
		let result = new JLong(KLInt64LogicalShiftLeft(int64, s));
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_lshr] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isInt()) {
			debugger;
		}
		let s = value2.val & 0x3F;
		let int64 = value1.val;
		let result = new JLong(KLInt64ArithmeticShiftRight(int64, s));
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_lushr] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isInt()) {
			debugger;
		}
		let s = value2.val & 0x3F;
		let int64 = value1.val;
		let result = new JLong(KLInt64ShiftRight(int64, s));
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_ladd] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isLong()) {
			debugger;
		}
		let longResult = KLInt64Add(value1.val, value2.val);
		let result = new JLong(longResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_lsub] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isLong()) {
			debugger;
		}
		let longResult = KLInt64Subtract(value1.val, value2.val);
		let result = new JLong(longResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_lmul] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isLong()) {
			debugger;
		}
		let longResult = KLInt64Multiply(value1.val, value2.val);
		let result = new JLong(longResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_l2i] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isLong()) {
			debugger;
		}
		let lowWord = value.val.lowWord();
		let result = new JInt(lowWord);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_i2l] = function(frame) {
		let value = frame.operandStack.pop();
		if (!value.isa.isInt()) {
			debugger;
		}			
		let intVal = value.val;
		let fillByte = (value.val < 0) ? 0xFF : 0x00;
		let bytes = [fillByte, fillByte, fillByte, fillByte, 
			(intVal >> 24) & 0xFF, (intVal >> 16) & 0xFF, (intVal >> 8) & 0xFF, intVal & 0xFF];
		let longResult = new KLInt64(bytes);
		let result = new JLong(longResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_land] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isLong()) {
			debugger;
		}
		let longResult = KLInt64BitwiseAnd(value1.val, value2.val);
		let result = new JLong(longResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_lor] = function(frame) {
		let value2 = frame.operandStack.pop();
		let value1 = frame.operandStack.pop();
		if (!value1.isa.isLong() || !value2.isa.isLong()) {
			debugger;
		}
		let longResult = KLInt64BitwiseOr(value1.val, value2.val);
		let result = new JLong(longResult);
		frame.operandStack.push(result);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_monitorenter] = function(frame) {
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		objectref.monitor++;
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_monitorexit] = function(frame) {
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		objectref.monitor--;
		if (objectref.monitor < 0) {
			debugger;
		}
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_lookupswitch] = function(frame) {
		let key = frame.operandStack.pop();
		if (!key.isa.isInt()) {
			debugger;
		}
		let pad = 4 - ((frame.pc % 4) + 1);
		let argsBase = 1 + pad;
		let defaultOffset = S32FromInstruction(frame, argsBase);
		let npairs = S32FromInstruction(frame, argsBase + 4);
		let pairsBase = argsBase + 8;
		if (npairs < 0) {
			debugger;
		}
		for (let i = 0; i < npairs; i++) {
			let match = S32FromInstruction(frame, pairsBase + (i * 8));
			let offset = S32FromInstruction(frame, pairsBase + (i * 8) + 4);
			if (match == key.val) {
				IncrementPC(frame, offset);
				return;
			}
		}
		IncrementPC(frame, defaultOffset);
	}
	
	this.instructionHandlers[INSTR_tableswitch] = function(frame) {
		let index = frame.operandStack.pop();
		if (!index.isa.isInt()) {
			debugger;
		}
		let pad = 4 - ((frame.pc % 4) + 1);
		let argsBase = 1 + pad;
		let defaultOffset = S32FromInstruction(frame, argsBase);
		let low = S32FromInstruction(frame, argsBase + 4);
		let high = S32FromInstruction(frame, argsBase + 8);
		if (low > high) {
			debugger;
		}
		if (index.val < low || index.val > high) {
			IncrementPC(frame, defaultOffset);
			return;
		}
		let offsetsBase = argsBase + 12;
		let tableIndex = index.val - low;
		let indexedOffset = offsetsBase + (tableIndex * 4);
		let jumpOffset = S32FromInstruction(frame, indexedOffset);
		IncrementPC(frame, jumpOffset);
	}
	
	this.instructionHandlers[INSTR_jsr] = function(frame) {
		let offset = S16FromInstruction(frame);
		let address = new JReturnAddress(frame.pc + 3);
		frame.operandStack.push(address);
		IncrementPC(frame, offset);
	}
	
	this.instructionHandlers[INSTR_ret] = function(frame) {
		let index = U8FromInstruction(frame);
		let address = frame.localVariables[index];
		if (!address || !address.isa.isReturnAddress()) {
			debugger;
		}
		frame.pc = address.val;
	}
}
