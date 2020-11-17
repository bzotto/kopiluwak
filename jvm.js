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
let PrimitivesToJavaLangClass = {};

// Debugger infrastructure
let JavaBreakpoints = [];  // { fileName: lineNumber} OR { methodName: fqmn }

function AddClass(klclass) {
	if (klclass.superclassName) {
		// Find the superclass to ensure that the chain above is already loaded.
		let superclass = ResolveClass(klclass.superclassName);
	
		if (!superclass) {
			console.log("JVM: Cannot load " + klclass.className + " before superclass " + klclass.superclassName);
			return;
		}
	
		klclass.superclass = superclass;
	}
	LoadedClasses.push(klclass);	
	console.log("JVM: Loaded class " + klclass.className);
}

function LoadClassFromJDK(className) {
	if (KLJDKClasses) {
		let classFileBase64 = KLJDKClasses[className];
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
			return KLClassFromLoadedClass(loadedClass);
		}
	}
	return null;
}

function CreateArrayClass(className) {
	// Create a synthetic "loaded class" for this array class. 
	let syntheticLoadedClass = new KLLoadedClass(className, 
		"java.lang.Object", 
		(ACC_PUBLIC | ACC_FINAL), 
		[],
		["java.lang.Cloneable", "java.io.Serializable"],
		[], []);
	// Create a class object for it.
	let superclass = ResolveClass("java.lang.Object");
	let klclass = new KLClass(syntheticLoadedClass, superclass);
	return klclass;		
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
	
	// Is this an array class? These are special KLClass instances that represent array types. 
	// Their names are array type descriptors.
	if (/^\[+(B|Z|I|D|F|C|J|S|L.+;)$/.test(className)) {
		let arrayClass = CreateArrayClass(className);
		AddClass(arrayClass);
		return arrayClass;
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

function JavaLangStringObjForJSString(jsStr) {
	let bytes = [];
    for (let i = 0; i < jsStr.length; i++) {
		let intobj = new JInt(jsStr.charCodeAt(i));
        bytes.push(intobj);
    }
	let byteArray = new JArray(new JType(JTYPE_BYTE), bytes.length);
	byteArray.elements = bytes;
	let stringClass = ResolveClass("java.lang.String");
	stringObj = stringClass.createInstance();
	stringObj.fieldValsByClass["java.lang.String"]["value"] = byteArray;
	stringObj.fieldValsByClass["java.lang.String"]["coder"] = new JInt(1);  // = UTF16
	stringObj.state = JOBJ_STATE_INITIALIZED;
	return stringObj;
}

function JSStringFromJavaLangStringObj(jobj) {
	if (jobj.class.className != "java.lang.String") {
		debugger;
	}
	let arrayref = jobj.fieldValsByClass["java.lang.String"]["value"];
	let jsstring = "";
	for (let i = 0; i < arrayref.elements.length; i++) {
		jsstring += String.fromCharCode(arrayref.elements[i].val);
	}
	return jsstring;
}

function JavaLangClassObjForClass(klclass) {
	let jclass = ClassesToJavaLangClass[klclass.className];
	if (!jclass) {
		let classClass = ResolveClass("java.lang.Class");
		if (!classClass) {
			
			// throw??
		}
		jclass = classClass.createInstance();
		// Set the referenced class name. [!] This is supposed to be set by native method initClassName.
		jclass.fieldValsByClass["java.lang.Class"]["name"] = JavaLangStringObjForJSString(klclass.className);
		jclass.meta["classClass"] = klclass;
		ClassesToJavaLangClass[klclass.className] = jclass;
	}
	return jclass;
}

function JavaLangClassObjForPrimitive(primitiveStr) {
	let jclass = PrimitivesToJavaLangClass[primitiveStr];
	if (!jclass) {
		let classClass = ResolveClass("java.lang.Class");
		if (!classClass) {
			
			// throw??
		}
		jclass = classClass.createInstance();
		// Set the referenced class name. [!] This is supposed to be set by native method initClassName.
		jclass.fieldValsByClass["java.lang.Class"]["name"] = JavaLangStringObjForJSString(primitiveStr);
		PrimitivesToJavaLangClass[primitiveStr] = jclass;
	}
	return jclass;
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

function DoesClassImplementInterface(className, interfaceName) {
	let startClass = ResolveClass(className);
	if (!startClass) {
		//??
		return false;
	}
	
	
	let targetClass = startClass;
	while (targetClass) {
		if (targetClass.implementsInterface(interfaceName)) {
			return true;
		}
		targetClass = targetClass.superclass;
	}
	return false;
}

function ResolveMethodReference(methodRef, contextClass) {
	// In general, we look for the method directly in the vtable of the contextClass, which is how overidden
	// methods are implemented here, with each subclass getting a full vtable of its whole inheritance chain.

	if (!contextClass) {
		if (methodRef.isInterface) {
			// ??
			debugger;
		}
		contextClass = ResolveClass(methodRef.className);
	}
	
	// Note that we don't resolve the method's own class, because we might be dealing with a subclass that the
	// originating methodRef doesn't know about. The vtable on subclasses should already be setup to match
	// inherited methods.
	let methodIdentifier = methodRef.methodName + "#" + methodRef.descriptor;
	var method = contextClass.vtable[methodIdentifier];
	
	if (!method) {
		console.log("ERROR: Failed to resolve method " + methodRef.methodName + " in " + methodRef.className + " with descriptor " + methodRef.descriptor);
		return null;
	} 
	
	return method;
}

function FindMainMethod() {
	let methodIdentifier = "main#([Ljava.lang.String;)V";
	let method = null;
	
	for (var i = 0; i < LoadedClasses.length; i++) {
		var klclass = LoadedClasses[i];
		method = klclass.vtable[methodIdentifier];
		if (method && (method.access & ACC_PUBLIC) && (method.access & ACC_STATIC)) {
			return method;
		}
	}
	return null;
}

function ClassInitializationMethod(klclass) {
	let methodIdentifier = "<clinit>#()V";
	return klclass.vtable[methodIdentifier];
}

function ResolveFieldReference(fieldRef) {
	let klclass = ResolveClass(fieldRef.className);
	
	if (klclass == null) {
		console.log("ERROR: Failed to resolve class " + fieldRef.className);
		return null;
	}
	
	let fieldClass = klclass;
	let field = fieldClass.fields[fieldRef.fieldName];
	while (!field && fieldClass.superclassName != null) {
		fieldClass = ResolveClass(fieldClass.superclassName);
		field = fieldClass.fields[fieldRef.fieldName];
	}
		
	// Fields match by name first, and then by desc. If we get a name match and fail 
	// the desc match, it's a failure, even if in theory there may be a superclass which 
	// defines a field with the same name and the correct type. 
	if (!field || field.type.descriptorString() != fieldRef.descriptor) {
		console.log("ERROR: Failed to resolve field " + fieldRef.fieldName + " in " + 
			fieldRef.className + " with descriptor " + fieldRef.descriptor);
		return {};
	}
	
	return { "class": fieldClass, "field": field };
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
	if (jobj.class.className == className) {
		return true;
	}
	if (IsClassASubclassOf(jobj.class.className, className)) {
		return true;
	}
	if (DoesClassImplementInterface(jobj.class.className, className)) {
		return true;
	}
	return false;
}

// This is a kitchen sink function that is currently far from comprehensive. 
function TypeIsAssignableToType(origin, dest) {
	if (!dest || !origin) {
		debugger;
	}
	
	if (dest.isIdenticalTo(origin)) {
		return true;
	} else if (dest.isBoolean() || dest.isByte() || dest.isChar() || dest.isShort() || dest.isInt()) {
		return origin.isInt();
	} else if (dest.isFloat()) {
		return origin.isFloat();
	} else if (dest.isDouble()) {
		return origin.isDouble();
	} else if (dest.isLong()) {
		return origin.isLong();
	} else if (dest.isReferenceType() && origin.isNull()) {
		// null is assignable to any reference destination.
		return true;
	} else if (dest.isArray()) {
		if (!origin.isArray()) {
			return false;
		}
		if (origin.arrayDimensions() != dest.arrayDimensions()) {
			return false;
		}
		return TypeIsAssignableToType(origin.arrayComponentType(), dest.arrayComponentType());
	} else if (dest.isClass()) {
		if (!origin.isClass()) {
			return false;
		}
		if (origin.className() == dest.className()) {
			return true;
		}
		if (IsClassASubclassOf(origin.className(), dest.className())) {
			return true;
		}
		if (DoesClassImplementInterface(origin.className(), dest.className())) {
			return true;
		}
		return false;
	} else {
		return origin.isIdenticalTo(dest);
	}
}

// >= 0 means a target was found. negative values mean there is no target for this exception
function HandlerPcForException(klclass, currentPC, exceptionObj, exceptionTable) {
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
			let targetClassRef = klclass.constantPool[exceptionEntry.catch_type];
			let targetClassName = klclass.stringFromUtf8Constant(targetClassRef.name_index);
			if (ObjectIsA(exceptionObj, targetClassName)) {
				return exceptionEntry.handler_pc;
			}
		}
	}
	return -1;
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
		let sourceFileName = frame.method.class.sourceFileName();
		
		let fqmn = frame.method.class.className + "." + frame.method.name;
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

function CreateClassInitFrameIfNeeded(klclass) {
	if (klclass.state == KLCLASS_STATE_INITIALIZED) {
		return null;
	}
	// Single-threaded VM allows us to also skip init entirely if we have already begun it
	if (klclass.state == KLCLASS_STATE_INITIALIZING) {
		return null;
	}
	
	let clinitMethod = ClassInitializationMethod(klclass);
	if (!clinitMethod) {
		klclass.state = KLCLASS_STATE_INITIALIZED;
		return null;
	}
	return new KLStackFrame(clinitMethod);
}

function CreateObjInitFrameIfNeeded(jobj) {
	if (jobj.state == JOBJ_STATE_INITIALIZED) {
		return null;
	}
	if (jobj.state == JOBJ_STATE_INITIALIZING) {
		return null;
	}
	let initIdentifier = "<init>#()V";
	let initMethod = jobj.class.vtable[initIdentifier];
	if (!initMethod) {
		jobj.state = JOBJ_STATE_INITIALIZED;
		return null;
	}
	return new KLStackFrame(initMethod);
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

function bpfn(methodName) {
	JavaBreakpoints.push({"methodName": methodName});
}

function BreakOnMethodStartIfNecessary(threadContext) {
	if (JavaBreakpoints.length == 0) {
		return;
	}
	let frame = threadContext.stack[0];
	let fqmn = frame.method.jclass.className + "." + frame.method.name;
	let hit = null;
	for (let i = 0; i < JavaBreakpoints.length; i++) {
		let bp = JavaBreakpoints[i];
		if (bp.methodName != undefined && bp.methodName == fqmn) {
			hit = bp;
		}
	}

	if (hit) {
		debugger;
	}
	
}

function BreakOnInstructionIfNecessary(threadContext) {
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
		if (lineEntry.start_pc == frame.pc) {
			lineNumber = lineEntry.line_number
			break;
		}
	}
	
	// See if there's a matching breakpoint.
	let hit = null;
	for (let i = 0; i < JavaBreakpoints.length; i++) {
		let bp = JavaBreakpoints[i];
		if (bp.fileName != undefined && bp.fileName == sourceFileName && bp.lineNumber == lineNumber) {
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
		// 	let soeClass = ResolveClass("java.lang.StackOverflowError");
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
			if (!returnType.isVoid()) {
				let defaultVal = DefaultObjectForJType(returnType);
				threadContext.stack[0].operandStack.push(defaultVal);
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
			BreakOnMethodStartIfNecessary(threadContext);
		}	
				
		// Enter the primary execution loop		
		while (pc < code.length) {
			// update this before executing so it's present in case we need to dump the user stack
			frame.pc = pc;       
			
			BreakOnInstructionIfNecessary(threadContext);
			
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
					frame.operandStack.push(new JInteger(JTYPE_INT, iconst));
					nextPc = pc + 1;
					break;
				}
			case 0x0B: // fconst_0
			case 0x0C: // fconst_1
			case 0x0D: // fconst_2
				{
					let fval = (opcode - 0x0B) * 1.0;
					frame.operandStack.push(new JFloat(JTYPE_FLOAT, fval));
					nextPc = pc + 1;
					break;
				}
			case 0x10: // bipush
				{
					let byte = code[pc+1];
					frame.operandStack.push(new JInteger(JTYPE_BYTE, byte));
					nextPc = pc + 2;
					break;
				}
			case 0x11: // sipush
				{
					let byte1 = code[pc+1];
					let byte2 = code[pc+2];
					let val = ((byte1 << 8) | byte2) >>> 0;
					frame.operandStack.push(new JInteger(JTYPE_SHORT, val));
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
						{
							let strconst = frame.method.jclass.loadedClass.constantPool[constref.string_index];
							let strbytes = strconst.bytes;
							// Create a string object to wrap the literal.
							let strclass = ResolveClass("java.lang.String");
							let strobj = strclass.createInstance();
							let arrobj = new JArray(T_INT, strbytes.length);
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
							frame.pc = pc + instlen;
							threadContext.stack.unshift(initFrame);
							executeNewFrame = true;						
						}						
						break;
					case CONSTANT_Integer:
						val = new JInteger(JTYPE_INT, constref.bytes);
						break;
					case CONSTANT_Float:
						{
							let bytes = [];
							bytes.push((constref.bytes >>> 24) & 0xFF);
							bytes.push((constref.bytes >>> 16) & 0xFF);
							bytes.push((constref.bytes >>> 8) & 0xFF);
							bytes.push((constref.bytes) & 0xFF);
							val = new JFloat(JTYPE_FLOAT, fromIEEE754Single(bytes));
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
			case 0x14: // ldc2_w
				{
					let indexbyte1 = code[pc+1];
					let indexbyte2 = code[pc+2];
					let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					let constref = frame.method.jclass.loadedClass.constantPool[index];
					let val;
					if (constref.tag == CONSTANT_Long) {
						if (constref.high_bytes != 0) {
							val = NaN;  // oh god
						} else {
							val = constref.low_bytes;
						}
						val = new JInteger(JTYPE_LONG, val);
					} else if (constref.tag == CONSTANT_Double) {
						let bytes = [];
						bytes.push((constref.high_bytes >>> 24) & 0xFF);
						bytes.push((constref.high_bytes >>> 16) & 0xFF);
						bytes.push((constref.high_bytes >>> 8) & 0xFF);
						bytes.push((constref.high_bytes) & 0xFF);
						bytes.push((constref.low_bytes >>> 24) & 0xFF);
						bytes.push((constref.low_bytes >>> 16) & 0xFF);
						bytes.push((constref.low_bytes >>> 8) & 0xFF);
						bytes.push((constref.low_bytes) & 0xFF);	
						val = new JFloat(JTYPE_DOUBLE, fromIEEE754Double(bytes));
					} else {
						console.log("ERROR: ldc2_w trying to load a constant that's not a long or double");
						val = undefined;
					}
					frame.operandStack.push(val);
					nextPc = pc + 3;
					break;
				}
			case 0x15: // iload
			case 0x16: // lload
			case 0x17: // fload
			case 0x18: // dload
			case 0x19: // aload
				{
					let index = code[pc+1];
					// Validate type correctness here.
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
					if (value != null && arrayref.jclass != value.jclass) {
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
			case 0x5A: // dup_x1
				{
					let value1 = frame.operandStack.pop();
					let value2 = frame.operandStack.pop();
					frame.operandStack.push(value1);
					frame.operandStack.push(value2);
					frame.operandStack.push(value1);
					nextPc = pc + 1;
					break;
				}
			case 0x60: // iadd
			case 0x61: // ladd
				{
					let add2 = frame.operandStack.pop();
					let add1 = frame.operandStack.pop();
					let res = new JInteger(JTYPE_INT, add1.val + add2.val);
					frame.operandStack.push(res);
					nextPc = pc + 1;
					break;
				}
			case 0x64: // isub
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let res = new JInteger(JTYPE_INT, value1.val - value2.val);
					frame.operandStack.push(res);
					nextPc = pc + 1;
					break;
				}
			case 0x6A: // fmul
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let res = new JFloat(JTYPE_FLOAT, value1.val * value2.val);
					frame.operandStack.push(res);
					nextPc = pc + 1;
					break;
				}
			case 0x6C: // idiv
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();					
					let div = value1.val / value2.val;
					let intresult = Math.trunc(div);
					frame.operandStack.push(new JInteger(JTYPE_INT, intresult));
					nextPc = pc + 1;
					break;
				}
			case 0x70: // irem
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					// this would be a good place to check for zero divisor and throw a runtime exception
					let result = value1.val - (Math.trunc(value1.val / value2.val)) * value2.val;
					frame.operandStack.push(new JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;
				}
			case 0x74: // ineg
				{
					let value = frame.operandStack.pop();
					let result = (~value.val) + 1;
					frame.operandStack.push(new JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;
				}
			case 0x78: // ishl
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let s = value2.val & 0x1F;
					let result = value1.val << s;
					frame.operandStack.push(new JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;
				}
			case 0x79: // lshl
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let s = value2.val & 0x3F;
					let result = value1.val << s;  // yeouch. this is not gonna work on anything actually "long"
					frame.operandStack.push(new JInteger(JTYPE_LONG, result));
					nextPc = pc + 1;
					break;
				}
			case 0x7A: // ishr
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let s = value2.val & 0x1F;
					let result = value1.val >> s;   // the JS >> operator does sign extension as ishr requires
					frame.operandStack.push(new JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;
				}
			case 0x7C: // iushr
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let s = value2.val & 0x1F;
					let result;
					if (value1.val > 0) {
						result = value1.val >> s;
					} else {
						result = (value1.val >> s) + (2 << ~s);
					}
					frame.operandStack.push(new JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;
				}
			case 0x7E: // iand
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1.val & value2.val;
					frame.operandStack.push(new JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;
				}
			case 0x7F: // land
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1.val & value2.val;
					frame.operandStack.push(new JInteger(JTYPE_LONG, result));
					nextPc = pc + 1;
					break;
				}
			case 0x82: // ixor
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1.val ^ value2.val;
					frame.operandStack.push(new JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;
				}
			case 0x83: // lxor
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					let result = value1.val ^ value2.val;
					frame.operandStack.push(new JInteger(JTYPE_LONG, result));
					nextPc = pc + 1;
					break;
				}
			case 0x84: // iinc
				{
					let index = code[pc+1];
					let c = code[pc+2];
					let val = frame.localVariables[index].val;
					val += c;
					frame.localVariables[index] = new JInteger(JTYPE_INT, result);
					nextPc = pc + 3;
					break;	
				}
			case 0x85: // i2l
				{
					let val = frame.operandStack.pop();
					let lval = new JInteger(JTYPE_LONG, val.val);
					frame.operandStack.push(lval);
					nextPc = pc + 1;
					break;						
				}
			case 0x86: // i2f
				{
					let val = frame.operandStack.pop();
					let fval = new JFloat(JTYPE_FLOAT, val.val);
					frame.operandStack.push(fval);
					nextPc = pc + 1;
					break;						
				}
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
					if (val.isNaN()) {
						result = 0;
					} else {
						result = Math.trunc(val.val);
					}
					frame.operandStack.push(JInteger(JTYPE_INT, result));
					nextPc = pc + 1;
					break;						
				}
			case 0x91: // i2b
				{
					let val = frame.operandStack.pop();
					let result = val.val & 0x000000FF;
					if ((result & 0x00000080) > 0) {
						// sign extend to int size
						result = result | 0xFFFFFF00;
					}
					frame.operandStack.push(JInteger(JTYPE_BYTE, result));
					nextPc = pc + 1;
					break;
				}
			case 0x95: // fcmpl
			case 0x96: // fcmpg
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					if (value1.isNaN() || value2.isNaN()) {
						if (opcode == 0x95) {
							frame.operandStack.push(JInteger(JTYPE_INT, -1));
						} else {
							frame.operandStack.push(JInteger(JTYPE_INT, 1));
						}
					} else if (value1 > value2) {
						frame.operandStack.push(JInteger(JTYPE_INT, 1));
					} else if (value1 == value2) {
						frame.operandStack.push(JInteger(JTYPE_INT, 0));
					} else if (value1 < value2) {
						frame.operandStack.push(JInteger(JTYPE_INT, -1));
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
					val = val.val;
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
					let value2 = frame.operandStack.pop().val;
					let value1 = frame.operandStack.pop().val;
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
			case 0xA5: // if_acmpeq
			case 0xA6: // if_acmpne
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					if ((opcode == 0xA5 && value1 == value2) ||
						(opcode == 0xA6 && value1 != value2)) {
						let branchbyte1 = code[pc+1];
						let branchbyte2 = code[pc+2];
						let offset = Signed16bitValFromTwoBytes(branchbyte1, branchbyte2);
						nextPc = pc + offset; // hm
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
			case 0xAF: // dreturn
				{
					let dval = frame.operandStack.pop();
					PopVmStackFrame(threadContext, true);
					threadContext.stack[0].operandStack.push(dval);
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
					let jmethod = new KLMethodDescriptor(methodInfo.descriptor);
					let nargs = jmethod.parameterTypes.length;
					let args = frame.operandStack.splice(nargs * -1.0, nargs);
					let jobj = frame.operandStack.pop();					
					args.unshift(jobj);
					// Resolve the method, using the target object's class.
					
					// If the method being requested is in a superclass of the *currently executing* method's class,
					// then it represents an explicit or implicit call into a superclass, which means that we *don't*
					// want to take overrides into account.
					if (!jobj) debugger;
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
					let jmethod = new KLMethodDescriptor(methodInfo.descriptor);
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
					let count = frame.operandStack.pop().val;
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
					let count = frame.operandStack.pop().val;
					let newarray = new JArray(arrayClass, count);
					frame.operandStack.push(newarray);
					nextPc = pc + 3;
					break;
				}
			case 0xBF: // athrow
				{
					let throwable = frame.operandStack.pop();
					if (!ObjectIsA(throwable, "java.lang.Throwable")) {
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
					frame.operandStack.push(new JInteger(JTYPE_INT, arrayref.count));
					nextPc = pc + 1;
					break;
				}
			case 0xC0: // checkcast
				{
					// XXX need to do a lot here!
					let obj = frame.operandStack.pop();
					if (obj == null) {
						frame.operandStack.push(null);
					} else {
						let indexbyte1 = code[pc+1];
						let indexbyte2 = code[pc+2];
						let index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
						let classOrArrayOrInterfaceRef = frame.method.jclass.loadedClass.constantPool[index];
						let className = frame.method.jclass.loadedClass.stringFromUtf8Constant(classOrArrayOrInterfaceRef.name_index);
						let castOK = false;
						if (className == "java.lang.String") {
							if (typeof obj == 'string') {
								castOK = true;
							}
						} else if (typeof obj == 'object' && obj.jclass.className == className ||
							IsClassASubclassOf(obj.jarray.className, className)) {
								castOK = true;
						}
						if (castOK) {
							// put it back
							frame.operandStack.push(obj);
						} else {
							alert("ClassCastException! Can't cast " + obj + " to " + className);
						}
					}
					nextPc = pc + 3;
					break;
				}
			case 0xC2: // monitorenter
				{
					let jobj = frame.operandStack.pop();
					jobj.monitor = jobj.monitor + 1;
					nextPc = pc + 1;
					break;
				}
			case 0xC3: // monitorexit
				{
					let jobj = frame.operandStack.pop();
					jobj.monitor = jobj.monitor - 1;
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

function KLClassFromLoadedClass(loadedClass) {
	// Resolve the superclass for this class.
	let superclass = ResolveClass(loadedClass.superclassName);	
	
	// Create the class object.
	let klclass = new KLClass(loadedClass, superclass);
	
	// Find and patch in native bindings for this class.
	let classImpls = KLNativeImpls[klclass.className];
	if (classImpls) {
		for (let methodIdentifier in klclass.vtable) {
			let method = klclass.vtable[methodIdentifier];
			if (!method.code && (method.access & ACC_NATIVE) != 0) {
				method.impl = classImpls[methodIdentifier];
			}
		}		
	}
		
	return klclass;
}

function InjectOutputMockObjects() {
		
	// Stuff that lets us print stuff to the console.
	var javaIoPrintStreamLoadedClass = new KLLoadedClass("java.io.PrintStream", "java.lang.Object", 0, [], [], [], [], []);
	var javaIoPrintStreamJclass = new KLClass(javaIoPrintStreamLoadedClass);
	javaIoPrintStreamJclass.vtable["println#(Ljava.lang.String;)V"] = { "name": "println", "class": javaIoPrintStreamJclass, "descriptor": new KLMethodDescriptor("(Ljava.lang.String;)V"), "access": ACC_PUBLIC, "code": null, "impl":
		function(jobj, x) {
			console.log(JSStringFromJavaLangStringObj(x));
		}
	};
	javaIoPrintStreamJclass.vtable["println#(I)V"] = { "name": "println", "class": javaIoPrintStreamJclass, "descriptor": new KLMethodDescriptor("(I)V"), "access": ACC_PUBLIC, "code": null, "impl":
		function(jobj, x) {
			console.log(x.val);
		}
	};
	AddClass(javaIoPrintStreamJclass);
	var systemOutStreamObj = javaIoPrintStreamJclass.createInstance();

	var javaLangSystemLoadedClass = new KLLoadedClass("java.lang.System", "java.lang.Object", 0, [], [], [], [], []);
	var javaLangSystemJclass = new KLClass(javaLangSystemLoadedClass);
	javaLangSystemJclass.fields["out"] = { "type": new JType("Ljava.io.PrintStream;"), "access": ACC_PUBLIC|ACC_STATIC};
	javaLangSystemJclass.fieldValsByClass["java.lang.System"]["out"] = systemOutStreamObj;
	AddClass(javaLangSystemJclass);
}

function LoadClassAndExecute(mainClassHex, otherClassesHex) {
	
	// Inject system crap so we don't need JDK for super simple tests
	// InjectOutputMockObjects();
	
	//Create the VM startup thread.
	// let initPhase1Method = ResolveMethodReference({"className": "java.lang.System", "methodName": "initPhase1", "descriptor": "()V"});
	// if (initPhase1Method) {
	// 	let ctx = new KLThreadContext(initPhase1Method);
	// 	ctx.exec();
	// }
	
	// Load the main class
	let classLoader = new KLClassLoader();
	let clresult = classLoader.loadFromHexString(mainClassHex);
	if (clresult.error) {
		return clresult.error;
	}
	let loadedClass = clresult.loadedClass;
	let klclass = KLClassFromLoadedClass(loadedClass);
	AddClass(klclass);
	let mainClass = klclass;
	
	// Load any auxiliary classes on offer.
	for (let i = 0; i < otherClassesHex.length; i++) {
		clresult = classLoader.loadFromHexString(otherClassesHex[i]);
		if (clresult.error) {
			return "error loading aux class " + i + "" + clresult.error;
		}
		klclass = KLClassFromLoadedClass(clresult.loadedClass);
		AddClass(klclass);
	}
	
	// one of these classes has a main method in it, find it.	
	var mainMethod = FindMainMethod();
	if (mainMethod) {
		let ctx = new KLThreadContext(mainMethod);
		ctx.exec();
	} else {
		return "Didn't find main method entry point"
	}
	return "";	
}