// 
// jvm.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, classloader
//

// Resolved classes
let LoadedClasses = [];
let ClassesToJavaLangClass = {};

// Debugger infrastructure
let JavaBreakpoints = [];  // { filename: lineNumber}

function AddClass(jclass) {
	if (jclass.superclassName) {
		// Find the superclass to ensure that the chain above is already loaded.
		let superclass = ResolveClass(jclass.superclassName);
	
		if (!superclass) {
			console.log("JVM: Cannot load " + jclass.className + " before superclass " + jclass.superclassName);
			return;
		}
	
		jclass.superclass = superclass;
	}
	LoadedClasses.push(jclass);	
	console.log("JVM: Loaded class " + jclass.className);
}

function LoadClassFromJDK(className) {
	if (KLJDKClasses) {
		let fqcn = className.replace(/\//g, ".");
		let classFileBase64 = KLJDKClasses[fqcn];
		if (classFileBase64) {
			let binaryStr = atob(classFileBase64);
			let len = binaryStr.length;
			let bytes = [];
		    for (let i = 0; i < len; i++)        {
		        bytes[i] = binaryStr.charCodeAt(i);
		    }
			let classLoader = new KLClassLoader();
			let clresult = classLoader.loadFromData(bytes);
			if (clresult.error) {
				console.log("ERROR: Failed to load JDK class " + className + ": " + clresult.error);
				return null;
			}
			let loadedClass = clresult.loadedClass;
			let jclass = JClassFromLoadedClass(loadedClass);
			return jclass;
		}
	}
	return null;
}
	
function ResolveClass(className) {
	if (!className) {
		return null;
	}
	
	for (var i = 0; i < LoadedClasses.length; i++) {
		var loadedClass = LoadedClasses[i];
		if (loadedClass.className == className) {
			return loadedClass;
		}
	}
	
	// Class was not present. Look in the JDK library.
	let jdkClass = LoadClassFromJDK(className);
	if (jdkClass) {
		AddClass(jdkClass);
		return jdkClass;
	}
	console.log("ERROR: Failed to resolve class " + className);
	return null;
}

function JavaLangClassObjForClass(jclass) {
	let jlcClass = ClassesToJavaLangClass[jclass];
	if (!jlcClass) {
		let classClass = ResolveClass("java/lang/Class");
		if (!classClass) {
			// throw??
		}
		jlcClass = classClass.createInstance();
		ClassesToJavaLangClass[jclass] = jlcClass;
	}
	return jlcClass;
}

function IsClassASubclassOf(className1, className2) {
	let targetClass = ResolveClass(className1);
	if (!targetClass) {
		//??
		return false;
	}
	
	let superclass = targetClass.superclass;
	while (superclass) {
		if (superclass.className == className2) {
			return true;
		}
		superclass = superclass.superclass;
	}
	
	return false;
}

function ResolveMethodReference(methodInfo, contextClass) {
	// In general, we look for the method directly in the vtable of the contextClass, which is how overidden
	// methods are implemented here, with each subclass getting a full vtable of its whole inheritance chain.

	if (!contextClass) {
		contextClass = ResolveClass(methodInfo.className);
	}
	
	// Note that we don't resolve the method's own class, because we might be dealing with a subclass that the
	// originating methodInfo doesn't know about. The vtable on subclasses should already be setup to match
	// inherited methods.
	let methodIdentifier = methodInfo.methodName + "#" + methodInfo.descriptor;
	var methodRef = contextClass.vtable[methodIdentifier];
	
	if (!methodRef) {
		console.log("ERROR: Failed to resolve method " + methodInfo.methodName + " in " + methodInfo.className + " with descriptor " + methodInfo.descriptor);
		return null;
	} 
	
	return methodRef;
}

function FindMainMethodReference() {
	let methodIdentifier = "main#([Ljava/lang/String;)V";
	let methodRef = null;
	
	for (var i = 0; i < LoadedClasses.length; i++) {
		var loadedClass = LoadedClasses[i];
		methodRef = loadedClass.vtable[methodIdentifier];
		if (methodRef && (methodRef.access & ACC_PUBLIC) && (methodRef.access & ACC_STATIC)) {
			return methodRef;
		}
	}
	return null;
}

function ClassInitializationMethod(jclass) {
	let methodIdentifier = "<clinit>#()V";
	return jclass.vtable[methodIdentifier];
}

function ResolveFieldReference(fieldInfo) {
	let jclass = ResolveClass(fieldInfo.className);
	
	if (jclass == null) {
		console.log("ERROR: Failed to resolve class " + fieldInfo.className);
		return {};
	}
	
	let fieldClass = jclass;
	let fieldRef = fieldClass.fields[fieldInfo.fieldName];
	while (!fieldRef && fieldClass.superclassName != null) {
		fieldClass = ResolveClass(fieldClass.superclassName);
		fieldRef = fieldClass.fields[fieldInfo.fieldName];
	}
		
	// Fields match by name first, and then by desc. If we get a name match and fail 
	// the desc match, it's a failure, even if in theory there may be a superclass which 
	// defines a field with the same name and the correct type. 
	if (!fieldRef || fieldRef.jtype.desc != fieldInfo.descriptor) {
		console.log("ERROR: Failed to resolve field " + fieldInfo.fieldName + " in " + 
			fieldInfo.className + " with descriptor " + fieldInfo.descriptor);
		return {};
	}
	
	return { "jclass": fieldClass, "field": fieldRef };
}

function Signed16bitValFromTwoBytes(val1, val2) {
	let sign = val1 & (1 << 7);
	let x = (((val1 & 0xFF) << 8) | (val2 & 0xFF));
	if (sign) {
		return (0xFFFF0000 | x);
	} 
	return x;
}

function ObjectIsA(jobj, className) {
	if (jobj.jclass.className == className) {
		return true;
	}
	let current = jobj.jclass;
	while (current.superclassName) {
		let superclassName = current.superclassName;
		current = ResolveClass(superclassName);
		if (current.className == className) {
			return true;
		}
	}
	
	// We ran out of superclasses
	return false;
}

// >= 0 means a target was found. negative values mean there is no target for this exception
function HandlerPcForException(jclass, currentPC, exceptionObj, exceptionTable) {
	if (!exceptionTable) {
		return -1;
	}
	for (let i = 0; i < exceptionTable.length; i++) {
		let exceptionEntry = exceptionTable[i];
		if (currentPC >= exceptionEntry.start_pc && currentPC < exceptionEntry.end_pc) {
			// This code range applies. Does the exception match the catch?
			if (exceptionEntry.catch_type == 0) {
				// All exceptions match (this implements 'finally')
				return exceptionEntry.handler_pc;
			}
			// Find target class
			let targetClassRef = jclass.loadedClass.constantPool[exceptionEntry.catch_type];
			let targetClassName = jclass.loadedClass.stringFromUtf8Constant(targetClassRef.name_index);
			if (ObjectIsA(exceptionObj, targetClassName)) {
				return exceptionEntry.handler_pc;
			}
		}
	}
	return -1;
}

function CreateStackFrame(method) {
	let frame = {};
	frame.method = method;
	frame.pc = 0;
	frame.localVariables = [];
	frame.operandStack = [];
	frame.pendingException = null;
	frame.completionHandlers = [];
	return frame;
}

function DebugBacktrace(threadContext) {	
	let backtrace = "";
	for (let i = 0; i < threadContext.stack.length; i++) {
		let frame = threadContext.stack[i];
		
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
		let sourceFileName = frame.method.jclass.loadedClass.sourceFileName();
		
		let fqmn = frame.method.jclass.className.replace(/\//g, ".") + "." + frame.method.name;
		if (!sourceFileName) {
			sourceFileName = "unknown";
		}
		if (!lineNumber) {
			lineNumber = "??";
		}
		backtrace += "\t" + (fqmn + "(" + sourceFileName + ":" + lineNumber + ")");
		if (i == 0) {
			backtrace += "\t<---";
		}	
		backtrace += "\n";
	}
	console.log(backtrace);
}

function CreateClassInitFrameIfNeeded(jclass) {
	if (jclass.state == JCLASS_STATE_INITIALIZED) {
		return null;
	}
	// Single-threaded VM allows us to also skip init entirely if we have already begun it
	if (jclass.state == JCLASS_STATE_INITIALIZING) {
		return null;
	}
	
	let clinitMethod = ClassInitializationMethod(jclass);
	if (!clinitMethod) {
		jclass.state = JCLASS_STATE_INITIALIZED;
		return null;
	}
	return CreateStackFrame(clinitMethod);
}

function CreateObjInitFrameIfNeeded(jobj) {
	if (jobj.state == JOBJ_STATE_INITIALIZED) {
		return null;
	}
	if (jobj.state == JOBJ_STATE_INITIALIZING) {
		return null;
	}
	let initIdentifier = "<init>#()V";
	let initMethod = jobj.jclass.vtable[initIdentifier];
	if (!initMethod) {
		jobj.state = JOBJ_STATE_INITIALIZED;
		return null;
	}
	return CreateStackFrame(initMethod);
}

function PopVmStackFrame(threadContext, isNormal) {
	let outgoingFrame = threadContext.stack.shift();
	if (isNormal) {
		for (let i = 0; i < outgoingFrame.completionHandlers.length; i++) {
			outgoingFrame.completionHandlers[i](outgoingFrame);
		}
	}
	console.log("--> Exiting " + outgoingFrame.method.jclass.className + "." + outgoingFrame.method.name);
	return outgoingFrame;
}

function bp(filename, ln) {
	JavaBreakpoints.push({"fileName": filename, "lineNumber": ln});
}

function DebugBreakIfNecessary(threadContext) {
	if (JavaBreakpoints.length == 0) {
		return;
	}
	
	let frame = threadContext.stack[0];
	
	// Is there a source file name?
	let sourceFileName = frame.method.jclass.loadedClass.sourceFileName();
	if (!sourceFileName) {
		return;
	}
		
	// Is there a line number table?
	let lineNumbers = frame.method.lineNumbers;
	if (!lineNumbers) {
		return;
	}
	let lineNumber = -1;
	for (let j = 0; j < lineNumbers.length; j++) {
		let lineEntry = lineNumbers[j];
		if (lineEntry.start_pc > frame.pc) {
			break;
		}
		lineNumber = lineEntry.line_number;
	}
	
	// See if there's a matching breakpoint.
	let hit = null;
	for (let i = 0; i < JavaBreakpoints.length; i++) {
		let bp = JavaBreakpoints[i];
		if (bp.fileName == sourceFileName && bp.lineNumber == lineNumber) {
			hit = bp;
		}
	}
	
	if (hit) {
		debugger;
	}
}

function RunJavaThreadWithMethod(startupMethod) {
	var threadContext = {};
	threadContext.stack = [];
	
	// Create the bottom frame. We won't execute this immediately, but it will be set up to be returned to.
	let baseFrame = CreateStackFrame(startupMethod);
	threadContext.stack.unshift(baseFrame);
		
	while (threadContext.stack.length > 0) {
		let executeNewFrame = false;
	
		// Did we blow the stack?
		// if (threadContext.stack.length > 10) {
		// 	let soeClass = ResolveClass("java/lang/StackOverflowError");
		// 	let soe = soeClass.createInstance();
		//
		// 	threadContext.stack[0].pendingExeption = soe;
		// }
		
		
		// Get reference to the top frame which we're currently running, and start executing.
		// We get here for the very start of every method, and also upon return from callers.
		let frame = threadContext.stack[0];
		let code = frame.method.code;
		let pc = frame.pc;	
	
		// If there's a pending exception in this frame, look for a handler for it at our current
		// pc and either go there first, or continue down the stack. 
		if (frame.pendingException) {
			let exception = frame.pendingException;
			frame.pendingException = null;
			
			let handlerPC = HandlerPcForException(frame.method.jclass, pc, exception, frame.method.exceptions);
			if (handlerPC >= 0) {
				// We can handle this one. Blow away the stack and jump to the handler.
				pc = handlerPC;
				frame.operandStack = [exception];
			} else if (threadContext.stack.length > 1) {
				// Nope. Kaboom.
				PopVmStackFrame(threadContext, false);
				threadContext.stack[0].pendingException = exception;
				continue;
			} else {
				// Nowhere left to throw... 
				console.log("JVM: Java thread terminated due to unhandled exception " + exception.className);
				return; 
			}
		} 	
		
		// If we are starting to execute a method contained in a class which is not yet initialized, then 
		// stop and initialize the class if appropriate.
		let clinitFrame = CreateClassInitFrameIfNeeded(frame.method.jclass);
		if (clinitFrame) { 
			frame.method.jclass.state = JCLASS_STATE_INITIALIZING;
			threadContext.stack.unshift(clinitFrame);
			continue;
		} 
		
		// Check if this is a native method we don't support. If so, log it and return a default value.
		if ((frame.method.access & ACC_NATIVE) != 0 && !frame.method.impl) {
			console.log("JVM: Eliding native method " + frame.method.jclass.className + "." + frame.method.name + " (desc: " + frame.method.jmethod.desc + ")");
			let nativeFrame = PopVmStackFrame(threadContext, true);
			let returnType = nativeFrame.method.jmethod.returnType;
			if (returnType.isObject() || returnType.isArray()) {
				threadContext.stack[0].operandStack.push(null);
			} else if (!returnType.isVoid()) {
				threadContext.stack[0].operandStack.push(0);
			} 
			continue;
		}
		
		// If this frame represents a method internal to the JVM, then execute it directly here. 
		// Locals are the args, and if the return type is not void, the result is pushed onto the callers
		// operand stack, as if it were a real method. 
		if (code == null && frame.method.impl) {
			console.log("--> Entering " + frame.method.jclass.className + "." + frame.method.name);
			let hasresult = (!frame.method.jmethod.returnType.isVoid());
			let result = frame.method.impl.apply(null, frame.localVariables);
			PopVmStackFrame(threadContext, true);
			if (hasresult) {
				threadContext.stack[0].operandStack.push(result);
			}
			continue;
		}
		
		// If we're entering a method, say what it is
		if (pc == 0) {
			console.log("--> Entering " + frame.method.jclass.className + "." + frame.method.name);
		}	
				
		// Enter the primary execution loop		
		while (pc < code.length) {
			// update this before executing so it's present in case we need to dump the user stack
			frame.pc = pc;       
			
			DebugBreakIfNecessary(threadContext);
			
			let opcode = code[pc];
			let nextPc;
		
			switch (opcode) {
			case 0x01: // aconst_null
				{
					frame.operandStack.push(null);
					nextPc = pc + 1;
					break;
				}
			case 0x02: // iconst_m1
			case 0x03: // iconst_0
			case 0x04: // iconst_1
			case 0x05: // iconst_2
			case 0x06: // iconst_3
			case 0x07: // iconst_4
			case 0x08: // iconst_5
				{
					let iconst = opcode - 3;
					frame.operandStack.push(iconst);
					nextPc = pc + 1;
					break;
				}
			case 0x0B: // fconst_0
			case 0x0C: // fconst_1
			case 0x0D: // fconst_2
				{
					let fval = (opcode - 0x0B) * 1.0;
					frame.operandStack.push(fval);
					nextPc = pc + 1;
					break;
				}
			case 0x10: // bipush
				{
					let byte = code[pc+1];
					frame.operandStack.push(byte);
					nextPc = pc + 2;
					break;
				}
			case 0x11: // sipush
				{
					let byte1 = code[pc+1];
					let byte2 = code[pc+2];
					let val = ((byte1 << 8) | byte2) >>> 0;
					frame.operandStack.push(val);
					nextPc = pc + 3;
					break;
				}
			case 0x12: // ldc
			case 0x13: // ldc_w
				{
					let instlen = ((opcode == 0x12) ? 2 : 3);
					let index;
					if (opcode == 0x12) {
						index = code[pc+1];
					} else {
						let indexbyte1 = code[pc+1];
						let indexbyte2 = code[pc+2];
						index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					}
					let constref = frame.method.jclass.loadedClass.constantPool[index];
					let val;
					switch (constref.tag) {
					case CONSTANT_Class:
						let className = frame.method.jclass.loadedClass.stringFromUtf8Constant(constref.name_index);
						let jclass = ResolveClass(className);
						let jobj = JavaLangClassObjForClass(jclass);
						let initFrame;
						if (jobj.state != JOBJ_STATE_INITIALIZED && (initFrame = CreateObjInitFrameIfNeeded(jobj))) {
							jobj.state = JOBJ_STATE_INITIALIZING;
							initFrame.completionHandlers.push(function() { 
								jobj.state = JOBJ_STATE_INITIALIZED;
							});
							frame.pc = pc;
							threadContext.stack.unshift(initFrame);
							executeNewFrame = true;						
						} else {
							val = jobj;
						}
						break;
					case CONSTANT_String:
						val = frame.method.jclass.loadedClass.stringFromUtf8Constant(constref.string_index);
						break;
					case CONSTANT_Integer:
						val = constref.bytes;
						break;
					case CONSTANT_Float:
						{
							let bits = constref.bytes;
							let sign = ((bits >>> 31) == 0) ? 1.0 : -1.0;
							let e = ((bits >>> 23) & 0xff);
							let m = (e == 0) ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
							let f = sign * m * Math.pow(2, e - 150);
							val = f;
							break;
						}
					default:
						alert("ldc needs a new case for constant " + constref.tag);
					}
					if (val != undefined) {
						frame.operandStack.push(val);
						nextPc = pc + instlen;
					}
					break;
				}
			case 0x15: // iload
			case 0x16: // lload
			case 0x17: // fload
			case 0x18: // dload
			case 0x19: // aload
				{
					let index = code[pc+1];
					frame.operandStack.push(frame.localVariables[index]);
					nextPc = pc + 2;
					break;
				}
			case 0x1A: // iload_0
			case 0x1B: // iload_1
			case 0x1C: // iload_2
			case 0x1D: // iload_3
				{
					let pos = opcode - 0x1A;
					frame.operandStack.push(frame.localVariables[pos]);
					nextPc = pc + 1;
					break;
				}
			case 0x22: // fload_0
			case 0x23: // fload_1
			case 0x24: // fload_2
			case 0x25: // fload_3
				{
					let pos = opcode - 0x22;
					frame.operandStack.push(frame.localVariables[pos]);
					nextPc = pc + 1;
					break;
				}
			case 0x2A: // aload_0
			case 0x2B: // aload_1
			case 0x2C: // aload_2
			case 0x2D: // aload_3
				{
					let pos = opcode - 0x2A;
					frame.operandStack.push(frame.localVariables[pos]);
					nextPc = pc + 1;
					break;
				}
			case 0x2E: // iaload
			case 0x2F: // laload
			case 0x30: // faload
			case 0x31: // daload
			case 0x32: // aaload
			case 0x33: // baload
			case 0x34: // caload
			case 0x35: // saload
				{
					let index = frame.operandStack.pop();
					let arrayref = frame.operandStack.pop();
					if (!arrayref) {
						DebugBacktrace(threadContext);
						return;
					}
 					let value = arrayref.elements[index];
					frame.operandStack.push(value);
					nextPc = pc + 1;
					break;
				}
			case 0x36: // istore
			case 0x37: // lstore
			case 0x38: // fstore
			case 0x39: // dstore
			case 0x3A: // astore
				{
					let index = code[pc+1];
					let aval = frame.operandStack.pop();
					frame.localVariables[index] = aval;
					nextPc = pc + 2;
					break;
				}
			case 0x3B: // istore_0
			case 0x3C: // istore_1
			case 0x3D: // istore_2
			case 0x3E: // istore_3
				{
					let pos = opcode - 0x3B;
					let ival = frame.operandStack.pop();
					frame.localVariables[pos] = ival;
					nextPc = pc + 1;
					break;
				}
			case 0x4B: // astore_0
			case 0x4C: // astore_1
			case 0x4D: // astore_2
			case 0x4E: // astore_3
				{
					let pos = opcode - 0x4B;
					let aval = frame.operandStack.pop();
					frame.localVariables[pos] = aval;
					nextPc = pc + 1;
					break;
				}
			case 0x4F: // iastore
			case 0x50: // lastore
			case 0x51: // fastore
			case 0x52: // dastore
			case 0x54: // bastore
			case 0x55: // castore
			case 0x56: // sastore
				{
					let value = frame.operandStack.pop();
					let index = frame.operandStack.pop();
					let arrayref = frame.operandStack.pop();
					if (opcode == 0x54) {
						if (arrayref.atype != T_BOOLEAN && arrayref.atype != T_BYTE) {
							console.log("JVM: bastore on bad array");
							return;
						}
					} else {
						let typeMap = { 0x4F: T_INT, 0x50: T_LONG, 0x51: T_FLOAT, 0x52: T_DOUBLE, 0x55: T_CHAR, 0x56: T_SHORT };
						let atype = typeMap[opcode];
						if (arrayref.atype != typeMap[opcode]) {
							console.log("JVM: store of type " + typeMap[opcode] + " on bad array");
							return;
						}
					}
					arrayref.elements[index] = value;
					nextPc = pc + 1;
					break;
				}
			case 0x53: // aastore
				{
					let value = frame.operandStack.pop();
					let index = frame.operandStack.pop();
					let arrayref = frame.operandStack.pop();
					if (arrayref.jclass != value.jclass) {
						console.log("JVM: aastore of " + value.jclass + " to array of " + arrayref.jclass.className);
						return;
					}
					arrayref.elements[index] = value;
					nextPc = pc + 1;
					break;
				}
			case 0x57: // pop
				{
					frame.operandStack.pop();
					nextPc = pc + 1;
					break;
				}
			case 0x59: // dup
				{
					let val = frame.operandStack.pop();
					frame.operandStack.push(val);
					frame.operandStack.push(val);
					nextPc = pc + 1;
					break;
				}
			case 0x60: // iadd
				{
					let add2 = frame.operandStack.pop();
					let add1 = frame.operandStack.pop();
					let res = add1 + add2;
					frame.operandStack.push(res);
					nextPc = pc + 1;
					break;
				}
			case 0x64: // isub
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1 - value2;
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;
				}
			case 0x6A: // fmul
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1 * value2;
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;
				}
			case 0x6C: // idiv
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let div = value1 / value2;
					let intresult = Math.trunc(div);
					frame.operandStack.push(intresult);
					nextPc = pc + 1;
					break;
				}
			case 0x70: // irem
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					// this would be a good place to check for zero divisor and throw a runtime exception
					let result = value1 - (Math.trunc(value1 / value2)) * value2;
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;
				}
			case 0x7C: // iushr
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let s = value2 & 0x1F;
					let result;
					if (value1 > 0) {
						result = value1 >> s;
					} else {
						result = (value1 >> s) + (2 << ~s);
					}
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;
				}
			case 0x7E: // iand
			case 0x7F: // land
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1 & value2;
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;
				}
			case 0x82: // ixor
			case 0x83: // lxor
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1 ^ value2;
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;
				}
			case 0x84: // iinc
				{
					let index = code[pc+1];
					let c = code[pc+2];
					let val = frame.localVariables[index];
					val += c;
					frame.localVariables[index] = val;
					nextPc = pc + 3;
					break;	
				}
			case 0x85: // i2l
			case 0x86: // i2f
			case 0x87: // i2d
				{
					// NOTHING. Sneaky.
					nextPc = pc + 1;
					break;						
				}
			case 0x8B: // f2i
			case 0x8E: // d2i
				{
					let val = frame.operandStack.pop();
					let result;
					if (isNaN(val)) {
						result = 0;
					} else {
						result = Math.trunc(val);
					}
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;						
				}
			case 0x95: // fcmpl
			case 0x96: // fcmpg
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					if (value1 == NaN || value2 == NaN) {
						if (opcode == 0x95) {
							frame.operandStack.push(-1);
						} else {
							frame.operandStack.push(1);
						}
					} else if (value1 > value2) {
						frame.operandStack.push(1);
					} else if (value1 == value2) {
						frame.operandStack.push(0);
					} else if (value1 < value2) {
						frame.operandStack.push(-1);
					}
					nextPc = pc + 1;
					break;
				}
			case 0x99: // ifeq
			case 0x9A: // ifne
			case 0x9B: // iflt
			case 0x9C: // ifge
			case 0x9D: // ifgt
			case 0x9E: // ifle
				{
					let val = frame.operandStack.pop();
					let doBranch = false;
					switch (opcode) {
					case 0x99: 
						doBranch = (val == 0);
						break;
					case 0x9A:
						doBranch = (val != 0);
						break;
					case 0x9B:
						doBranch = (val < 0);
						break;
					case 0x9C:
						doBranch = (val >= 0);
						break;
					case 0x9D:
						doBranch = (val > 0);
						break;
					case 0x9E:
						doBranch = (val <= 0);
						break;
					}
					if (doBranch) {
						let branchbyte1 = code[pc+1];
						let branchbyte2 = code[pc+2];
						let offset = Signed16bitValFromTwoBytes(branchbyte1, branchbyte2);
						nextPc = pc + offset; // probably want to bounds check this guy lol
					} else {
						nextPc = pc + 3;
					}
					break;
				}
			case 0x9F: // if_icmpeq
			case 0xA0: // if_icmpne
			case 0xA1: // if_icmplt
			case 0xA2: // if_icmpge
			case 0xA3: // if_icmpgt
			case 0xA4: // if_icmple
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let doBranch = false;
					switch (opcode) {
					case 0x9F:
						doBranch = (value1 == value2);
						break;
					case 0xA0:
						doBranch = (value1 != value2);
						break;
					case 0xA1:
						doBranch = (value1 < value2);
						break;
					case 0xA2:
						doBranch = (value1 >= value2);
						break;
					case 0xA3:
						doBranch = (value1 > value2);
						break;
					case 0xA4:
						doBranch = (value1 <= value2);
						break;
					}
					if (doBranch) {
						let branchbyte1 = code[pc+1];
						let branchbyte2 = code[pc+2];
						let offset = Signed16bitValFromTwoBytes(branchbyte1, branchbyte2);
						nextPc = pc + offset; // probably want to bounds check this guy lol
					} else {
						nextPc = pc + 3;
					}
					break;
				}
			case 0xA7: // goto
				{
					let branchbyte1 = code[pc+1];
					let branchbyte2 = code[pc+2];
					let offset = Signed16bitValFromTwoBytes(branchbyte1, branchbyte2);
					nextPc = pc + offset; // hm
					break;
				}
			case 0xAC: // ireturn
				{
					let ival = frame.operandStack.pop();
					// blow away all the other frame state.
					PopVmStackFrame(threadContext, true);
					// push the return value onto the caller's stack
					threadContext.stack[0].operandStack.push(ival);
					executeNewFrame = true;
					break;
				}
			case 0xB0: // areturn
				{
					let aval = frame.operandStack.pop();
					PopVmStackFrame(threadContext, true);
					threadContext.stack[0].operandStack.push(aval);
					executeNewFrame = true;
					break;					
				}
			case 0xB1: // return 
				{
					PopVmStackFrame(threadContext, true);
					executeNewFrame = true;
					break;
				}
			case 0xB2: // getstatic
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// Resolve a static field for this index. 
					let fieldInfo = frame.method.jclass.loadedClass.fieldInfoFromIndex(index);
					let fieldRef = ResolveFieldReference(fieldInfo);  // returns {jclass, field reference}
					// Is the class in which the field lives intialized yet? 
					if (fieldRef.jclass.state != JCLASS_STATE_INITIALIZED && (clinitFrame = CreateClassInitFrameIfNeeded(fieldRef.jclass))) {
						fieldRef.jclass.state = JCLASS_STATE_INITIALIZING;
						threadContext.stack.unshift(clinitFrame);
						executeNewFrame = true;
						frame.pc = pc;
					} else {
						// Get the value of the static field XXXX
						let fieldValue = fieldRef.jclass.fieldValsByClass[fieldInfo.className][fieldInfo.fieldName];
						frame.operandStack.push(fieldValue);
						nextPc = pc + 3;
					}
					break;
				}
			case 0xB3: // putstatic
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// Resolve a static field for this index. 
					let fieldInfo = frame.method.jclass.loadedClass.fieldInfoFromIndex(index);
					let fieldRef = ResolveFieldReference(fieldInfo);  // returns {jclass, field reference}
					// Is the class in which the field lives intialized yet? 
					if (fieldRef.jclass.state != JCLASS_STATE_INITIALIZED && (clinitFrame = CreateClassInitFrameIfNeeded(fieldRef.jclass))) {
						fieldRef.jclass.state = JCLASS_STATE_INITIALIZING;
						threadContext.stack.unshift(clinitFrame);
						executeNewFrame = true;
						frame.pc = pc;
					} else {
						let fieldValue = frame.operandStack.pop();
						fieldRef.jclass.fieldValsByClass[fieldInfo.className][fieldInfo.fieldName] = fieldValue;
						nextPc = pc + 3;
					}
					break;
				}
			case 0xB4: // getfield
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					let fieldInfo = frame.method.jclass.loadedClass.fieldInfoFromIndex(index);
					let fieldRef = ResolveFieldReference(fieldInfo);
					let jobj = frame.operandStack.pop();
					let val = jobj.fieldValsByClass[fieldInfo.className][fieldInfo.fieldName];
					frame.operandStack.push(val);
					nextPc = pc + 3;
					break;
				}
			case 0xB5: // putfield
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					let fieldInfo = frame.method.jclass.loadedClass.fieldInfoFromIndex(index);
					let fieldRef = ResolveFieldReference(fieldInfo);
					let val = frame.operandStack.pop();
					let jobj = frame.operandStack.pop();
					jobj.fieldValsByClass[fieldInfo.className][fieldInfo.fieldName] = val;
					nextPc = pc + 3;
					break;
				}
			case 0xB6: // invokevirtual
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					let methodInfo = frame.method.jclass.loadedClass.methodInfoFromIndex(index);
					// Build descriptor so we know how to find the target object.
					let jmethod = new JMethod(methodInfo.descriptor);
					let nargs = jmethod.parameterTypes.length;
					let args = frame.operandStack.splice(nargs * -1.0, nargs);
					let jobj = frame.operandStack.pop();
					
					// let args = frame.operandStack.slice(nargs * -1.0, frame.operandStack.length);
					// let jobj = frame.operandStack[frame.operandStack.length - nargs - 1];
					args.unshift(jobj);
					if (!jobj) {
						DebugBacktrace(threadContext);
						return;
					}
					// Resolve the method, using the target object's class.
					
					// If the method being requested is in a superclass of the *currently executing* method's class,
					// then it represents an explicit or implicit call into a superclass, which means that we *don't*
					// want to take overrides into account.
					let contextClass = jobj.jclass;
					if (IsClassASubclassOf(frame.method.jclass.className, methodInfo.className)) {
						contextClass = null;
					}
					let methodRef = ResolveMethodReference(methodInfo, contextClass);  
					
					let childFrame = CreateStackFrame(methodRef);		
					childFrame.localVariables = args;
					
					// Save the current next-PC state.
					frame.pc = pc + 3;
				
					threadContext.stack.unshift(childFrame);
					executeNewFrame = true;						
					break;				
				}
			case 0xB7: // invokespecial
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					let methodInfo = frame.method.jclass.loadedClass.methodInfoFromIndex(index);
					// Build descriptor so we know how to find the target object.
					let jmethod = new JMethod(methodInfo.descriptor);
					let nargs = jmethod.parameterTypes.length;
					let args = frame.operandStack.splice(nargs * -1.0, nargs);
					let jobj = frame.operandStack.pop();
					args.unshift(jobj);
					// Resolve the method, using the target object's class.
					
					// If the method being requested is in a superclass of the *currently executing* method's class,
					// then it represents an explicit or implicit call into a superclass, which means that we *don't*
					// want to take overrides into account.
					let contextClass = jobj.jclass;
					if (IsClassASubclassOf(frame.method.jclass.className, methodInfo.className)) {
						contextClass = null;
					}
					let methodRef = ResolveMethodReference(methodInfo, contextClass);  
					let childFrame = CreateStackFrame(methodRef);		
					childFrame.localVariables = args;
					
					// Save the current next-PC state.
					frame.pc = pc + 3;
				
					threadContext.stack.unshift(childFrame);
					executeNewFrame = true;						
					break;
				}
			case 0xB8: // invokestatic
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// Resolve a static method for this index. 
					let methodInfo = frame.method.jclass.loadedClass.methodInfoFromIndex(index);
					let methodRef = ResolveMethodReference(methodInfo, null);  // what's the right class param here
					let nargs = methodRef.jmethod.parameterTypes.length;
					let args = frame.operandStack.splice(nargs * -1.0, nargs);

					let childFrame = CreateStackFrame(methodRef);		
					childFrame.localVariables = args;
					
					// Save the current next-PC state.
					frame.pc = pc + 3;
					
					threadContext.stack.unshift(childFrame);
					// Break out of this execution loop.
					executeNewFrame = true;
					break;
				}
			case 0xBC: // newarray
				{
					let atype = code[pc+1];
					let count = frame.operandStack.pop();
					let newarray = new JArray(atype, count);
					frame.operandStack.push(newarray);
					nextPc = pc + 2;
					break;
				}
			case 0xBD: // anewarray
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					let constref = frame.method.jclass.loadedClass.constantPool[index];
					let className = frame.method.jclass.loadedClass.stringFromUtf8Constant(constref.name_index);
					let arrayClass = ResolveClass(className);
					let count = frame.operandStack.pop();
					let newarray = new JArray(arrayClass, count);
					frame.operandStack.push(newarray);
					nextPc = pc + 3;
					break;
				}
			case 0xBF: // athrow
				{
					let throwable = frame.operandStack.pop();
					if (!ObjectIsA(throwable, "java/lang/Throwable")) {
						console.log("JVM: Can't throw object of class " + throwable.jclass.className);
					}
					let handlerPc = HandlerPcForException(frame.method.jclass, pc, throwable, frame.method.exceptions);
					if (handlerPc >= 0) {
						nextPc = handlerPc;
						frame.operandStack = [throwable];
					} else {
						// This frame can't handle this exception, so blow it up, and stick
						// the exception object in the next frame down the stack and make *it* figure it out.
						PopVmStackFrame(threadContext, false);
						threadContext.stack[0].pendingException = throwable;
						executeNewFrame = true;
					}
					break;
				}
			case 0xBA: // invokedynamic
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// get the constant entry for the invokedynamic
					let cdynamic = frame.method.jclass.loadedClass.constantPool[index];
					let bootstrapIndex = cdynamic.bootstrap_method_attr_index;
					let bootstrapAttr = frame.method.jclass.loadedClass.attributeWithName("BootstrapMethods");
					let bootstrap = bootstrapAttr.bootstrap_methods[bootstrapIndex];
					let bootstrapMethodRef = bootstrap.bootstrap_method_ref;
					let bootstrapArgs = bootstrap.bootstrap_arguments;
					let methodHandle = frame.method.jclass.loadedClass.constantPool[bootstrapMethodRef];
					if (methodHandle.reference_kind == REF_invokeStatic) {
						// We expect the other field in the handle to reference a methodrefinfo
						let methodRefInfo = frame.method.jclass.loadedClass.methodInfoFromIndex(methodHandle.reference_index);
						let methodRef = ResolveMethodReference(methodRefInfo, frame.method.jclass);  // returns {jclass, method reference}
						
						
					} else {
						// ¯\_(ツ)_/¯ 
					}
					
					
					break;
				}
			case 0xBB: // new
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					let classRef = frame.method.jclass.loadedClass.constantPool[index];
					let className = frame.method.jclass.loadedClass.stringFromUtf8Constant(classRef.name_index);
					let jclass = ResolveClass(className);
					let jObj = jclass.createInstance();
					frame.operandStack.push(jObj);
					nextPc = pc + 3;
					break;
				}
			case 0xBE: // arraylength
				{
					let arrayref = frame.operandStack.pop();
					frame.operandStack.push(arrayref.count);
					nextPc = pc + 1;
					break;
				}
			case 0xC6: // ifnull
				{
					let branchbyte1 = code[pc+1];
					let branchbyte2 = code[pc+2];
					let offset = Signed16bitValFromTwoBytes(branchbyte1, branchbyte2);
					let val = frame.operandStack.pop();
					if (val == null) {
						nextPc = pc + offset; // hm
					} else {
						nextPc = pc + 3;
					}
					break;
				}
			case 0xC7: // ifnonnull
				{
					let branchbyte1 = code[pc+1];
					let branchbyte2 = code[pc+2];
					let offset = Signed16bitValFromTwoBytes(branchbyte1, branchbyte2);
					let val = frame.operandStack.pop();
					if (val != null) {
						nextPc = pc + offset; // hm
					} else {
						nextPc = pc + 3;
					}
					break;
				}
			default:
				console.log("JVM: Internal error: Unsupported opcode " + opcode + " at PC = " + pc);
				return 0;
			}
			
			if (executeNewFrame) {
				executeNewFrame = false;
				break;
			} 
			if (nextPc == pc) {
				console.log("Last opcode " + opcode + " didn't update PC");
			}
			pc = nextPc;
		}
				
	}
	console.log("JVM: Java thread exited successfully.");
	return 0;
}

function JClassFromLoadedClass(loadedClass) {
	let jclass = new JClass(loadedClass);
	
	// The vtable for each class starts out as a copy of its superclass's vtable, if there
	// is one.
	let jsuperclass = ResolveClass(jclass.superclassName);	
	jclass.vtable = jsuperclass ? Object.assign({}, jsuperclass.vtable) : {};

	// Walk the methods in the class and patch them up.
	for (let i = 0; i < loadedClass.methods.length; i++) {
		let method = loadedClass.methods[i];
		let name = loadedClass.stringFromUtf8Constant(method.name_index);
		let desc = loadedClass.stringFromUtf8Constant(method.descriptor_index);
		let access_flags = method.access_flags;
		
		// Is there code?	
		let codeAttr = null;
		for (var j = 0; j < method.attributes.length; j++) {
			let attr = method.attributes[j];
			let attrname = loadedClass.stringFromUtf8Constant(attr.attribute_name_index);
			if (attrname == "Code") {
				codeAttr = attr;
				break;
			}
		}
		
		let methodIdentifier = name + "#" + desc;
		
		// If there's no code, maybe we have a native impl.
		let impl = null;
		if (!codeAttr && ((access_flags & ACC_NATIVE) != 0)) {
			let classImpls = KLNativeImpls[jclass.className];
			if (classImpls) {
				impl = classImpls[methodIdentifier];
			}
		}
		
		// Find a line number table if one exists.
		let lineNumberTable = null;
		if (codeAttr && codeAttr.attributes) {
			for (let j = 0; j < codeAttr.attributes.length; j++) {
				let attr = codeAttr.attributes[j];
				let attrname = loadedClass.stringFromUtf8Constant(attr.attribute_name_index);
				if (attrname == "LineNumberTable") {
					lineNumberTable = attr.line_number_table;
					break;
				}
			}
		}
		
		// The implementing jclass is included because the vtable gets copied to subclasses upon load.
		jclass.vtable[methodIdentifier] = { 
			"name": name, 
			"jclass": jclass,
			"jmethod": new JMethod(desc), 
			"access": access_flags, 
			"impl": impl, 
			"code": codeAttr ? codeAttr.code : null,
			"exceptions": codeAttr ? codeAttr.exception_table : null,
			"lineNumbers": lineNumberTable 
		};
	}
	
	// Walk the fields in the class and patch them up!
	for (var i = 0; i < loadedClass.fields.length; i++) {
		var field = loadedClass.fields[i];
		var name = loadedClass.stringFromUtf8Constant(field.name_index);
		var desc = loadedClass.stringFromUtf8Constant(field.descriptor_index);
		var access_flags = field.access_flags;
		
		jclass.fields[name] = { "jtype": new JType(desc), "access": access_flags };
	}
	
	return jclass;
}

function InjectOutputMockObjects() {
		
	// Stuff that lets us print stuff to the console. 
	// var javaIoPrintStreamLoadedClass = new JLoadedClass("java/io/PrintStream", "java/lang/Object", [], [], [], []);
	// var javaIoPrintStreamJclass = new JClass(javaIoPrintStreamLoadedClass);
	// javaIoPrintStreamJclass.vtable["println#(Ljava/lang/String;)V"] = { "name": "println", "jclass": javaIoPrintStreamJclass, "jmethod": new JMethod("(Ljava/lang/String;)V"), "access": ACC_PUBLIC, "code": null, "impl":
	// 	function(jobj, x) {
	// 		console.log(x);
	// 	}
	// };
	// javaIoPrintStreamJclass.vtable["println#(I)V"] = { "name": "println", "jclass": javaIoPrintStreamJclass, "jmethod": new JMethod("(I)V"), "access": ACC_PUBLIC, "code": null, "impl":
	// 	function(jobj, x) {
	// 		console.log(x);
	// 	}
	// };
	// AddClass(javaIoPrintStreamJclass);
	// var systemOutStreamObj = javaIoPrintStreamJclass.createInstance();
	//
	// var javaLangSystemLoadedClass = new JLoadedClass("java/lang/System", "java/lang/Object", [], [], [], []);
	// var javaLangSystemJclass = new JClass(javaLangSystemLoadedClass);
	// javaLangSystemJclass.fields["out"] = { "jtype": new JType("Ljava/io/PrintStream;"), "access": ACC_PUBLIC|ACC_STATIC};
	// javaLangSystemJclass.fieldValsByClass["java/lang/System"]["out"] = systemOutStreamObj;
	// AddClass(javaLangSystemJclass);
}

function LoadClassAndExecute(mainClassHex, otherClassesHex) {
	
	// Inject system crap so we don't need JDK for super simple tests
	InjectOutputMockObjects();
	
	// Create the VM startup thread. 
	let initPhase1Method = ResolveMethodReference({"className": "java/lang/System", "methodName": "initPhase1", "descriptor": "()V"});
	if (initPhase1Method) {
		RunJavaThreadWithMethod(initPhase1Method);
	}	
	
	// Load the main class
	let classLoader = new KLClassLoader();
	let clresult = classLoader.loadFromHexString(mainClassHex);
	if (clresult.error) {
		return clresult.error;
	}
	let loadedClass = clresult.loadedClass;
	let jclass = JClassFromLoadedClass(loadedClass);
	AddClass(jclass);
	let mainClass = jclass;
	
	// Load any auxiliary classes on offer.
	for (let i = 0; i < otherClassesHex.length; i++) {
		clresult = classLoader.loadFromHexString(otherClassesHex[i]);
		if (clresult.error) {
			return "error loading aux class " + i + "" + clresult.error;
		}
		jclass = JClassFromLoadedClass(clresult.loadedClass);
		AddClass(jclass);
	}
	
	// one of these classes has a main method in it, find it.	
	var methodRef = FindMainMethodReference();
	if (methodRef) {
		RunJavaThreadWithMethod(methodRef);
	} else {
		return "Didn't find main method entry point"
	}
	return "";	
}