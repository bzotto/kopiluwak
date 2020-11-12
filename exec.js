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
	
	this.throwException = function(exceptionClassName) {
		let npeClass = ResolveClass(exceptionClassName);
		let e = npeClass.createInstance();
		this.stack[0].pendingException = e; // Not initialized yet but will be when we unwind back to it!
		let initFrame = CreateObjInitFrameIfNeeded(e);
		initFrame.localVariables[0] = e;
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
				} else if (this.stack.length > 1) {
					// Nope. Kaboom.
					this.popFrame(true);
					this.stack[0].pendingException = exception;
					continue;
				} else {
					// Nowhere left to throw... 
					console.log("JVM: Java thread terminated due to unhandled exception " + exception.class.className);
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
				if ((frame.method.access & ACC_NATIVE) != 0 || code == null) { // XXX the code==null condition just helps us with mock objects
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
						if (!nativeFrame.method.descriptor.returnsVoid()) {
							let returnType = nativeFrame.method.descriptor.returnType();
							let defaultVal = DefaultValueForType(returnType);
							this.stack[0].operandStack.push(defaultVal);
						}
					} 
					continue;
				}	
			}
			
			if (!code) {
				debugger;
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
	// Construction
	// 
	
	if (bootstrapMethod) {
		let baseFrame = new KLStackFrame(bootstrapMethod);
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
					for (let i = 0; i < strbytes.length; i++) {
						arrobj.elements[i] = new JInt(strbytes[i]);
					}
					// Rig the current frame and the child completion to land on the next instruction with the 
					// stack looking right.
					let initMethod = ResolveMethodReference({"className": "java.lang.String", "methodName": "<init>", "descriptor": "([III)V"});
					let initFrame = new KLStackFrame(initMethod);
					initFrame.localVariables.push(strobj);
					initFrame.localVariables.push(arrobj);
					initFrame.localVariables.push(new JInt(0));
					initFrame.localVariables.push(new JInt(arrobj.count));
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
	this.instructionHandlers[INSTR_ldc] = instr_ldc;
	this.instructionHandlers[INSTR_ldc_w] = instr_ldc;
	
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
	
	this.instructionHandlers[INSTR_getfield] = function(frame) {
		let index = U16FromInstruction(frame);
		let fieldRef = frame.method.class.fieldReferenceFromIndex(index);
		let field = ResolveFieldReference(fieldRef);
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType()) {
			debugger;
		}
		let value = objectref.fieldValsByClass[fieldRef.className][fieldRef.fieldName];
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
			if (fieldRef.className != frame.method.class.className || 
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
		
		objectref.fieldValsByClass[fieldRef.className][fieldRef.fieldName] = objectref;
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
	
	this.instructionHandlers[INSTR_anewarray] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let constref = frame.method.class.constantPool[index];
		let className = frame.method.class.classNameFromUtf8Constant(constref.name_index);
		let arrayClass = ResolveClass(className);
		let count = frame.operandStack.pop();
		if (!count.isa.isInt()) {
			debugger;
		}
		if (count < 0) {
			thread.throwException("NegativeArraySizeException");
			return;
		}
		let newarray = new JArray(arrayClass.typeOfInstances, count.val);
		frame.operandStack.push(newarray);
		IncrementPC(frame, 3);
	}
	
	this.instructionHandlers[INSTR_newarray] = function(frame, opcode, thread) {
		let count = frame.operandStack.pop();
		if (!count.isa.isInt()) {
			debugger;
		}
		if (count < 0) {
			thread.throwException("NegativeArraySizeException");
			return;
		}
		let atype = U8FromInstruction(frame);
		if (atype < 4 || atype > 11) {
			debugger;
		}
		let jtype = JTypeFromJVMArrayType(atype);
		let arrayref = new JArray(jtype, count);
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
		frame.operandStack.push(value);
		frame.operandStack.push(value);
		IncrementPC(frame, 1);
	}
	
	this.instructionHandlers[INSTR_invokestatic] = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let methodRef = frame.method.class.methodReferenceFromIndex(index);
		let method = ResolveMethodReference(methodRef, null);  // what's the right class param here?
		let argsCount = method.descriptor.argumentCount();
		let args = frame.operandStack.splice(argsCount * -1.0, argsCount);
		let childFrame = new KLStackFrame(method);		
		childFrame.localVariables = args;
		IncrementPC(frame, 3);
		thread.pushFrame(childFrame);
	}
	
	const instr_invokevirtual = function(frame, opcode, thread) {
		let index = U16FromInstruction(frame);
		let methodRef = frame.method.class.methodReferenceFromIndex(index);
		// Build descriptor so we know how many arguments there are.
		let methodDesc = new KLMethodDescriptor(methodRef.descriptor);
		let argsCount = methodDesc.argumentCount();
		let args = frame.operandStack.splice(argsCount * -1.0, argsCount);
		let jobj = frame.operandStack.pop();
		args.unshift(jobj);
		// If the method being requested is in a superclass of the *currently executing* method's class,
		// then it represents an explicit or implicit call into a superclass, which means that we *don't*
		// want to take overrides into account.
		let contextClass = jobj.class;
		if (IsClassASubclassOf(frame.method.class.className, methodRef.className)) {
			contextClass = null;
		}
		let method = ResolveMethodReference(methodRef, contextClass);  
		let childFrame = new KLStackFrame(method);		
		childFrame.localVariables = args;
		IncrementPC(frame, 3);
		thread.pushFrame(childFrame);
	}
	this.instructionHandlers[INSTR_invokevirtual] = instr_invokevirtual;
	this.instructionHandlers[INSTR_invokespecial] = instr_invokevirtual;
	
	const instr_aload_n = function(frame, opcode) {
		let n = opcode - INSTR_aload_0;
		let objectref = frame.localVariables[n];
		if (!objectref.isa.isReferenceType()) {
			// error. throw?
			console.log("aload_n expected reference type");
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
		if (!TypeIsAssignableToType(value.isa, returnType)) {
			debugger;
		}
		thread.popFrame();
		thread.stack[0].operandStack.push(value);
	}
	
	this.instructionHandlers[INSTR_areturn] = function(frame, opcode, thread) {
		let objectref = frame.operandStack.pop();
		if (!objectref.isa.isReferenceType() || !TypeIsAssignableToType(objectref.isa, frame.method.descriptor.returnType())) {
			debugger;
		}
		thread.popFrame();
		thread.stack[0].operandStack.push(objectref);
	}
	
	const instr_iload_n = function(frame, opcode) {
		let n = opcode - INSTR_iload_0;
		let value = frame.localVariables[n];
		if (!value.isa.isInt()) {
			// error. throw?
			console.log("iload_n expected int type");
			debugger;
		}
		frame.operandStack.push(value);
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_iload_0] = instr_iload_n;
	this.instructionHandlers[INSTR_iload_1] = instr_iload_n;
	this.instructionHandlers[INSTR_iload_2] = instr_iload_n;
	this.instructionHandlers[INSTR_iload_3] = instr_iload_n;
	
	this.instructionHandlers[INSTR_arraylength] = function(frame, opcode, thread) {
		let arrayref = frame.operandStack.pop();
		if (arrayref.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return;
		}
		if (!arrayref.isa.isArray()) {
			// error should be understood statically. throw?
			debugger;
		}
		let length = new JInt(arrayref.count);
		frame.operandStack.push(length);
		IncrementPC(frame, 1);
	}
	
	const instr_if_cond = function(frame, opcode) {
		let value = frame.operandStack.pop();
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
			arrayref.elements[indexVal] = new JInt(value.val & 0xFF);
			break;
		case INSTR_castore:
		case INSTR_sastore:
			arrayref.elements[indexVal] = new JInt(value.val & 0xFFFF);
			break;
		}
		IncrementPC(frame, 1);
	}
	this.instructionHandlers[INSTR_iastore] = instr_int_astore;
	this.instructionHandlers[INSTR_bastore] = instr_int_astore;
	this.instructionHandlers[INSTR_castore] = instr_int_astore;
	this.instructionHandlers[INSTR_sastore] = instr_int_astore;
	
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
	
}