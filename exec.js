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

function KLThreadContext(bootstrapMethod) {

	this.stack = [];
	
	if (bootstrapMethod) {
		let baseFrame = new KLStackFrame(bootstrapMethod);
		this.stack.push(baseFrame);
	}
		
	this.pushFrame = function(frame) {
		this.stack.unshift(frame);
	}
	
	this.popFrame = function(isAbrupt) {
		let isNormal = !(isAbrupt);
		let outgoingFrame = this.stack.shift();
		if (isNormal) {
			for (let i = 0; i < outgoingFrame.completionHandlers.length; i++) {
				outgoingFrame.completionHandlers[i](outgoingFrame);
			}
		}
		console.log("--> Exiting " + outgoingFrame.method.class.className + "." + outgoingFrame.method.name);
		return outgoingFrame;
	}
	
	this.currentFQMethodName = function() {
		let frame = this.stack[0];
		if (!frame) {
			return null;
		}
		return frame.method.class.className + "." + frame.method.name;
	}
	
	this.exec = function() {
		while (this.stack.length > 0) {
			let frame = this.stack[0];
			let code = frame.method.code;
			let pc = frame.pc;	
			
			// If there's a pending exception in this frame, look for a handler for it at our current
			// pc and either go there first, or continue down the stack. 
			if (frame.pendingException) {
				let exception = frame.pendingException;
				frame.pendingException = null;
			
				let handlerPC = HandlerPcForException(frame.method.class, pc, exception, frame.method.exceptions);
				if (handlerPC >= 0) {
					// We can handle this one. Blow away the stack and jump to the handler.
					pc = handlerPC;
					frame.operandStack = [exception];
				} else if (threadContext.stack.length > 1) {
					// Nope. Kaboom.
					this.popFrame(true);
					this.stack[0].pendingException = exception;
					continue;
				} else {
					// Nowhere left to throw... 
					console.log("JVM: Java thread terminated due to unhandled exception " + exception.className);
					return; 
				}
				
			}
			
			// Are we at the top of a method? If so, a couple special cases are handled now:
			// 1. If this method is part of a class which has not yet been initialized.
			// 2. If this method is native and either has a bound implementation that is not bytecode or has no implementation.
			if (pc == 0) {
				// If we are starting to execute a method contained in a class which is not yet initialized, then 
				// stop and initialize the class if appropriate. We check this first, because we'll need to do this 
				// whether or not the method itself has a native implementation.
				let clinitFrame = CreateClassInitFrameIfNeeded(frame.method.class);
				if (clinitFrame) {
					frame.method.class.state = KLCLASS_STATE_INITIALIZING;
					this.pushFrame(clinitFrame);
					continue;
				}
				
				// If this is a native method, either execute it or if not present, pretend it executed and returned
				// some default value. 
				if ((frame.method.access & ACC_NATIVE) != 0) {
					// Check if this is a native method we don't support. If so, log it and return a default value.
					if (frame.method.impl) {
						// Execute the native method impl if present.
						let hasresult = !frame.method.descriptor.returnsVoid();
						let result = frame.method.impl.apply(null, frame.localVariables);
						this.popFrame();
						if (hasresult) {
							this.stack[0].operandStack.push(result);
						}
					} else {				
						console.log("JVM: Eliding native method " + frame.method.class.className + "." + frame.method.name + " (desc: " + frame.method.descriptor.descriptorString() + ")");
						let nativeFrame = this.popFrame();
						if (!frame.method.descriptor.returnsVoid()) {
							let returnType = nativeFrame.method.descriptor.returnType();
							let defaultVal = DefaultValueForType(returnType);
							this.stack[0].operandStack.push(defaultVal);
						}
					} 
					continue;
				}	
			}
			
			// Verify that the pc is valid. 
			if (pc < 0 || pc >= code.length) {
				console.log("JVM: Error: pc " + pc + " invalid for method " + this.currentFQMethodName());
				return;
			}
						
			// Fetch and execute the next instruction.
			let opcode = code[pc];
			let handler = this.instructionHandlers[opcode];
			if (!handler) {
			    let str = Number(opcode).toString(16);
			    str = str.length == 1 ? "0x0" + str : "0x" + str;
				alert("Unimplemented opcode " + str);
				debugger;			
			}
			handler(frame, opcode, this);
		}
	}
	
	
	//
	// Exec helper snippets for instruction handling.
	//
		
	function IncrementPC(frame, count) {
		frame.pc = frame.pc + count;
	}
	
	function U8FromInstruction(frame) {
		let code = frame.method.code;
		let byte = code[frame.pc + 1];
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
	
	const handler_ldc = function(frame, opcode, thread) {
		let instlen = ((opcode == INSTR_ldc) ? 2 : 3);
		let index;
		if (opcode == INSTR_ldc) {
			index = U8FromInstruction(frame);
		} else {
			index = U16FromInstruction(frame);
		}
		let constref = frame.method.class.constantPool[index];
		let val;
		switch (constref.tag) {
			case CONSTANT_Class:
				{
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
						// Do not increment the PC here, we will restart this instruction.
					} else {
						val = jobj;
					}
					break;
				}
			case CONSTANT_String:
				{
					let strconst = frame.method.class.constantPool[constref.string_index];
					let strbytes = strconst.bytes;
					// Create a string object to wrap the literal.
					let strclass = ResolveClass("java.lang.String");
					let strobj = strclass.createInstance();
					let arrobj = new JArray(new JType(JTYPE_INT), strbytes.length);
					arrobj.elements = strbytes;
					// Rig the current frame and the child completion to land on the next instruction with the 
					// stack looking right.
					let initMethod = ResolveMethodReference({"className": "java.lang.String", "methodName": "<init>", "descriptor": "([III)V"});
					let initFrame = CreateStackFrame(initMethod);
					initFrame.localVariables.push(strobj);
					initFrame.localVariables.push(arrobj);
					initFrame.localVariables.push(0);
					initFrame.localVariables.push(arrobj.count);
					initFrame.completionHandlers.push(function() { 
						strobj.state = JOBJ_STATE_INITIALIZED;
					});
					frame.operandStack.push(strobj); // by the time the string init returns, this should be set up.
					IncrementPC(frame, instlen);
					thread.pushFrame(initFrame);
					break;
				}
			default:
				alert("ldc needs a new case for constant " + constref.tag);
		}
		if (val != undefined) {
			frame.operandStack.push(val);
			IncrementPC(frame, instlen);
		}
	};
	this.instructionHandlers[INSTR_ldc] = handler_ldc;
	this.instructionHandlers[INSTR_ldc_w] = handler_ldc;
	
	this.instructionHandlers[INSTR_getstatic] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let fieldRef = frame.method.class.fieldReferenceFromIndex(index);
		let field = ResolveFieldReference(fieldRef);  
		// Is the class in which the field lives intialized yet? 
		if (field.class.state != KLCLASS_STATE_INITIALIZED && (clinitFrame = CreateClassInitFrameIfNeeded(field.class))) {
			field.class.state = KLCLASS_STATE_INITIALIZING;
			thread.pushFrame(clinitFrame);
		} else {
			// Get the value of the static field XXXX
			let fieldValue = field.class.fieldValsByClass[fieldRef.className][fieldRef.fieldName];
			frame.operandStack.push(fieldValue);
			IncrementPC(frame, 3);
		}
	}
	
	this.instructionHandlers[INSTR_putstatic] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let fieldRef = frame.method.class.fieldReferenceFromIndex(index);
		let field = ResolveFieldReference(fieldRef);  
		// Is the class in which the field lives intialized yet? 
		if (field.class.state != KLCLASS_STATE_INITIALIZED && (clinitFrame = CreateClassInitFrameIfNeeded(field.class))) {
			field.class.state = KLCLASS_STATE_INITIALIZING;
			thread.pushFrame(clinitFrame);
		} else {
			let fieldValue = frame.operandStack.pop();
			field.class.fieldValsByClass[fieldRef.className][fieldRef.fieldName] = fieldValue;
			IncrementPC(frame, 3);
		}
	}
	
	const handler_iconst_n = function(frame, opcode) {
		let val = opcode - INSTR_iconst_0;
		frame.operandStack.push(new JInt(val));
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_iconst_m1] = handler_iconst_n;
	this.instructionHandlers[INSTR_iconst_0] = handler_iconst_n;
	this.instructionHandlers[INSTR_iconst_1] = handler_iconst_n;
	this.instructionHandlers[INSTR_iconst_2] = handler_iconst_n;
	this.instructionHandlers[INSTR_iconst_3] = handler_iconst_n;
	this.instructionHandlers[INSTR_iconst_4] = handler_iconst_n;
	this.instructionHandlers[INSTR_iconst_5] = handler_iconst_n;
	
	this.instructionHandlers[INSTR_anewarray] = function(frame) {
		let index = U16FromInstruction(frame);
		let constref = frame.method.class.constantPool[index];
		let className = frame.method.class.classNameFromUtf8Constant(constref.name_index);
		let arrayClass = ResolveClass(className);
		let count = frame.operandStack.pop().val;
		let newarray = new JArray(arrayClass.typeOfInstances, count);
		frame.operandStack.push(newarray);
		IncrementPC(frame, 3);
	}
	
}