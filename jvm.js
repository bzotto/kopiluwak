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
	
	// Ensure not already loaded
	for (var i = 0; i < LoadedClasses.length; i++) {
		var loadedClass = LoadedClasses[i];
		if (loadedClass.name == klclass.name) {
			KLLogWarn("Class named " + klclass.name + " is already loaded");
			return;
		}
	}

	if (klclass.superclassName) {
		// Find the superclass to ensure that the chain above is already loaded.
		let superclass = ResolveClass(klclass.superclassName);
	
		if (!superclass) {
			KLLogWarn("Cannot load " + klclass.name + " before superclass " + klclass.superclassName);
			return;
		}
	
		klclass.superclass = superclass;
	}
	LoadedClasses.push(klclass);	
	KLLogInfo("Loaded class " + klclass.name);
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
				KLLogWarn("Failed to load JDK class " + className + ": " + clresult.error);
				return null;
			}
			let loadedClass = clresult.loadedClass;
			return KLClassFromLoadedClass(loadedClass);
		}
	}
	return null;
}

function CreateArrayClassFromName(className) {
	if (className[0] != "[") {
		debugger;
	}
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

function CreateArrayClassWithAttributes(componentClass, dimensions) {
	let descStr = "";
	for (let i = 0; i < dimensions; i++) {
		descStr += "[";
	}
	descStr += ("L" + componentClass.name + ";");
	return CreateArrayClassFromName(descStr);
}
	
function ResolveClass(className) {
	if (!className) {
		return null;
	}
	
	// This routine can accept class and interface names in descriptor format for parallelism with 
	// acceptance of array descriptors. If that's what we've been given, extract the class or
	// interface name.
	let classDesc = className.match(/^L(.+);$/)
	if (classDesc && classDesc.length == 2) {
		className = classDesc[1];
	}
	
	for (var i = 0; i < LoadedClasses.length; i++) {
		var loadedClass = LoadedClasses[i];
		if (loadedClass.name == className) {
			return loadedClass;
		}
	}
	
	// Is this an array class? These are special KLClass instances that represent array types. 
	// Their names are array type descriptors.
	if (/^\[+(B|Z|I|D|F|C|J|S|L.+;)$/.test(className)) {
		let arrayClass = CreateArrayClassFromName(className);
		AddClass(arrayClass);
		return arrayClass;
	}
	
	// Class was not present. Look in the JDK library.
	let jdkClass = LoadClassFromJDK(className);
	if (jdkClass) {
		AddClass(jdkClass);
		return jdkClass;
	}
		
	KLLogWarn("Failed to resolve class " + className);
	return null;
}

function JavaLangStringObjForJSString(jsStr) {
	let bytes = KLUTF16ArrayFromString(jsStr);
	let ints = [];
    for (let i = 0; i < bytes.length; i++) {
		let intobj = new JByte(bytes[i]);
        ints.push(intobj);
    }
	let arrayClass = ResolveClass("[B");
	let byteArray = new JArray(arrayClass, ints.length);
	byteArray.elements = ints;
	let stringClass = ResolveClass("java.lang.String");
	stringObj = stringClass.createInstance();
	stringObj.fieldValsByClass["java.lang.String"]["value"] = byteArray;
	stringObj.fieldValsByClass["java.lang.String"]["coder"] = new JInt(1);  // = UTF16
	stringObj.state = JOBJ_STATE_INITIALIZED;
	return stringObj;
}

function JSStringFromJavaLangStringObj(jobj) {
	if (!jobj || !jobj.class) { debugger; }
	
	if (jobj.class.name != "java.lang.String") {
		debugger;
	}
	let coder = jobj.fieldValsByClass["java.lang.String"]["coder"];
	let arrayref = jobj.fieldValsByClass["java.lang.String"]["value"];
	let jsstring = "";
	if (coder.val == 0) {
		// LATIN1 decoding is trivial. 
		for (let i = 0; i < arrayref.elements.length; i++) {
			jsstring += String.fromCharCode(arrayref.elements[i].val);
		}		
	} else if (coder.val == 1) {
		// UTF16 decoding
		let bytes = [];
		for (let i = 0; i < arrayref.elements.length; i++) {
			bytes.push(arrayref.elements[i].val)
		}		
		jsstring = KLStringFromUTF16Array(bytes);
		if (!jsstring) {
			KLLogWarn("Unable to decode UTF16 byte array to string");
		}
	}
	return jsstring;
}

function JSStringFromByteArrayDEBUG(jarray) {
	if (!jarray.isa.isArray() || !jarray.isa.arrayComponentType().isByte()) {
		debugger;
		return "";
	}
	let jsstring = "";
	for (let i = 0; i < jarray.elements.length; i++) {
		jsstring += String.fromCharCode(jarray.elements[i].val);
	}
	return jsstring;
}

function JavaLangClassObjForClass(klclass) {
	if (!klclass) { debugger; }
	
	let jclass = ClassesToJavaLangClass[klclass.name];
	if (!jclass) {
		let classClass = ResolveClass("java.lang.Class");
		if (!classClass) {
			
			// throw??
		}
		jclass = classClass.createInstance();
		// Set the referenced class name. [!] This is supposed to be set by native method initClassName.
		jclass.fieldValsByClass["java.lang.Class"]["name"] = JavaLangStringObjForJSString(klclass.name);
		jclass.meta["classClass"] = klclass;
		ClassesToJavaLangClass[klclass.name] = jclass;
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
		jclass.meta["primitiveName"] = primitiveStr;
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
		if (superclass.name == className2) {
			return true;
		}
		superclass = superclass.superclass;
	}
	
	return false;
}

function DoesClassImplementInterface(className, interfaceName) {
	let startClass = ResolveClass(className);
	if (!startClass) {
		debugger;
	}
	return startClass.implementsInterface(interfaceName);
}

function MatchMethodAmongSuperinterfaces(methodName, methodDescriptor, interfaceName) {
	let methods = [];
	let startInterface = ResolveClass(interfaceName);
	if (!startInterface.isInterface()) { debugger; }
	let method = startInterface.vtableEntry(methodName, methodDescriptor);
	// Does this interface have a matching method?
	// NB: The check for non-abstract is not really given in S5.4.3.3 where maximal specificity is defined, but it IS 
	// expected when doing method search in invokespecial and invokevirtual, the only contexts where we use this logic.
	if (method && 
		!AccessFlagIsSet(method.access, ACC_PRIVATE) && 
		!AccessFlagIsSet(method.access, ACC_STATIC), 
		!AccessFlagIsSet(method.access, ACC_ABSTRACT)) { // see comment above re ABSTRACT
		methods.push(method);
	}
	// Accumulate any matches in further superinterfaces. 
	for (let superinterfaceName in startInterface.interfaces) {
		methods = methods.concat(FindMethodInInterface(methodName, methodDescriptor, superinterfaceName));
	}
	return methods;
}

function FindSoleMaximallySpecifiedSuperinterfaceMethod(klclass, methodName, methodDescriptor) {
	// Recursively look through all superinterfaces and their superinterfaces to find matching methods. We
	// want to find all hits so we can determine whether there's only one.
	let methods = [];
	for (let superinterfaceName in klclass.interfaces) {
		methods = methods.concat(MatchMethodAmongSuperinterfaces(methodName, methodDescriptor, superinterfaceName));
	}
	
	if (methods.length == 1) {
		return methods[0];
	}
	
	return null;
}

// S2.9
function IsMethodSignaturePolymorphic(method) {
	if (method.class.name == "java.lang.invoke.MethodHandle" &&
		method.descriptor.argumentCount() == 1 &&
		method.descriptor.argumentTypeAtIndex(0).isIdenticalTo(new JType("[Ljava.lang.Object;")) &&
		!method.descriptor.returnsVoid() && method.descriptor.returnType().isIdenticalTo(new JType("Ljava.lang.Object;")) &&
		AccessFlagIsSet(method.access, ACC_VARARGS) && AccessFlagIsSet(method.access, ACC_NATIVE)) {
		return true;
	}
	return false;
}

// XXX Now that the invoke* ops are following the book more precisely, this needs to be revisited, ie, what should this
function ResolveMethodReference(methodRef) {
	// Note that we don't resolve the method's own class, because we might be dealing with a subclass that the
	// originating methodRef doesn't know about. The vtable on subclasses should already be setup to match
	// inherited methods.
	let klclass = ResolveClass(methodRef.className);
	let methodIdentifier = methodRef.methodName + "#" + methodRef.descriptor;
	var method = klclass.vtable[methodIdentifier];
	
	if (!method) {
		KLLogWarn("Failed to resolve method " + methodRef.methodName + " in " + methodRef.className + " with descriptor " + methodRef.descriptor);
		return null;
	} 
	
	return method;
}

function FullyQualifiedMethodName(method) {
	return method.class.name + "." + method.name;
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
		KLLogWarn("Failed to resolve class " + fieldRef.className);
		return null;
	}
	
	let fieldClass = klclass;
	let field = fieldClass.fields[fieldRef.fieldName];
	while (!field && fieldClass.superclassName != null) {
		fieldClass = fieldClass.superclass;
		field = fieldClass.fields[fieldRef.fieldName];
	}
		
	// Fields match by name first, and then by desc. If we get a name match and fail 
	// the desc match, it's a failure, even if in theory there may be a superclass which 
	// defines a field with the same name and the correct type. 
	if (!field || field.type.descriptorString() != fieldRef.descriptor) {
		KLLogWarn("Failed to resolve field " + fieldRef.fieldName + " in " + 
			fieldRef.className + " with descriptor " + fieldRef.descriptor);
		return {};
	}
	
	return { "name": fieldRef.fieldName, "class": fieldClass, "field": field };
}

function ObjectIsA(jobj, className) {
	if (jobj.class.name == className) {
		return true;
	}
	if (IsClassASubclassOf(jobj.class.name, className)) {
		return true;
	}
	if (DoesClassImplementInterface(jobj.class.name, className)) {
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
		if (!origin.isClass() && !origin.isArray()) {
			return false;
		}
		if (origin.className() == dest.className()) {
			return true;
		}
		if (origin.isClass()) {
			if (IsClassASubclassOf(origin.className(), dest.className())) {
				return true;
			}
			if (DoesClassImplementInterface(origin.className(), dest.className())) {
				return true;
			}
		} else if (origin.isArray()) {
			if (IsClassASubclassOf(origin.descriptorString(), dest.className())) {
				return true;
			}
			if (DoesClassImplementInterface(origin.descriptorString(), dest.className())) {
				return true;
			}
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
			let targetClassName = klclass.classNameFromUtf8Constant(targetClassRef.name_index);
			if (ObjectIsA(exceptionObj, targetClassName)) {
				return exceptionEntry.handler_pc;
			}
		}
	}
	return -1;
}

function DebugBacktrace(threadContext) {	
	let threadBacktrace = threadContext.currentBacktrace();
	let backtrace = "";
	for (let i = 0; i < threadBacktrace.length; i++) {
		let frame = threadBacktrace[i];
		let fqmn = frame.className + "." + frame.methodName;
		backtrace += "\t" + (fqmn + "(" + (frame.fileName ? frame.fileName : "unknown") + ":" + (frame.lineNumber ? frame.lineNumber : "??") + ")");
		if (i == 0) {
			backtrace += "\t<---";
		}	
		backtrace += "\n";
	}
	KLLogInfo(backtrace);
	return backtrace;
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

function CreateObjInitFrameForObjectAndDescriptor(jobj, desc) {
	let initIdentifier = "<init>#" + desc;
	let initMethod = jobj.class.vtable[initIdentifier];
	if (!initMethod) {
		debugger;
		return null;
	}
	return new KLStackFrame(initMethod);
}

function bp(filename, ln) {
	JavaBreakpoints.push({"fileName": filename, "lineNumber": ln});
}

function bpfn(methodName) {
	JavaBreakpoints.push({"methodName": methodName});
}

function ShouldBreakOnMethodStart(threadContext) {
	if (JavaBreakpoints.length == 0) {
		return;
	}
	let frame = threadContext.stack[0];
	let fqmn = frame.method.class.name + "." + frame.method.name;
	for (let i = 0; i < JavaBreakpoints.length; i++) {
		let bp = JavaBreakpoints[i];
		if (bp.methodName != undefined && bp.methodName == fqmn) {
			return true;
		}
	}

	return false;
}

function ShouldBreakOnInstruction(threadContext) {
	if (JavaBreakpoints.length == 0) {
		return;
	}
	
	let frame = threadContext.stack[0];
	
	// Is there a source file name?
	let sourceFileName = frame.method.class.sourceFileName();
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
	for (let i = 0; i < JavaBreakpoints.length; i++) {
		let bp = JavaBreakpoints[i];
		if (bp.fileName != undefined && bp.fileName == sourceFileName && bp.lineNumber == lineNumber) {
			return true;
		}
	}
	
	return false;
}

function KLClassFromLoadedClass(loadedClass) {
	// Resolve the superclass for this class.
	let superclass = ResolveClass(loadedClass.superclassName);	
	
	// Create the class object.
	let klclass = new KLClass(loadedClass, superclass);
	
	// Find and patch in native bindings for this class.
	let classImpls = KLNativeImpls[klclass.name];
	if (classImpls) {
		for (let methodIdentifier in classImpls) {
			let impl = classImpls[methodIdentifier];
			let method = klclass.vtable[methodIdentifier];
			if (!method) {
                // The impl's identifier wasn't found on the class...
                debugger; 
           	}
			if (method.impl != null) {
				debugger;
			}
			if (!method.code && (method.access & ACC_NATIVE) != 0) {
				method.impl = classImpls[methodIdentifier];
			}
		}		
	}
		
	return klclass;
}


let KLJVMStarted = false;
function KLJVMStartup(stdioHooks, logHook) {
	if (KLJVMStarted) {
		KLLogInfo("JVM already started");
		return;
	}
	
	if (logHook != undefined) {
		KLLogOutputFn = logHook;
	}	
	
	if (stdioHooks.out) {
		KLStdout = new KLDirectOutput(stdioHooks.out);
	}
	
	KLLogInfo("Kopiluwak JVM startup: executing java.lang.System.initPhase1");
	
	//Create the VM startup thread.
	let initPhase1Method = ResolveMethodReference({"className": "java.lang.System", "methodName": "initPhase1", "descriptor": "()V"});
	if (initPhase1Method) {
		let ctx = new KLThreadContext(initPhase1Method);
		ctx.exec();
	}
	
	KLLogInfo("JVM: Ready.");
	KLJVMStarted = true;
	
	// let initPhase2Method = ResolveMethodReference({"className": "java.lang.System", "methodName": "initPhase2", "descriptor": "(ZZ)I"});
	// if (initPhase2Method) {
	// 	let ctx = new KLThreadContext(initPhase2Method, [JBooleanFalse, JBooleanFalse]);
	// 	ctx.exec();
	// 	// debugger;
	// }
}

let KLJVMMainThread = null;

function KLJVMExecute(mainClassHex) {
		
	if (!KLJVMStarted) {
		debugger;
		return;
	}
		
	if (!KLJVMMainThread) {
		if (!mainClassHex) {
			debugger;
		}
		let classLoader = new KLClassLoader();
		let clresult = classLoader.loadFromHexString(mainClassHex);
		if (clresult.error) {
			KLLogError("Failed to load class file: " + clresult.error);
			return;
		}
		let loadedClass = clresult.loadedClass;
		let klclass = KLClassFromLoadedClass(loadedClass);
		AddClass(klclass);
		
		// Find the main entry point.
		var mainMethod = FindMainMethod();
		if (mainMethod) {
			KLJVMMainThread = new KLThreadContext(mainMethod);
		} else {
			KLLogError("No class found with public static main entry point");
			return;
		}
	}
		
	if (KLJVMMainThread.state != KLTHREAD_STATE_RUNNING) {
		return;
	}
		
	KLJVMMainThread.exec();
	
	if (KLJVMMainThread.state == KLTHREAD_STATE_ENDED) {
		KLLogInfo("JVM: Execution completed");
		KLJVMMainThread = null;
	} else if (KLJVMMainThread.state == KLTHREAD_STATE_WAITING) {
		KLLogInfo("JVM: Waiting");
	}
}

function KLJVMSubmitInput(fd, inputBytes) {
	if (fd != KLFD_stdin) {
		KLLogWarn("Only stdin file desceriptor is currently recognized for input");
		return;
	}

	for (let i = 0; i < inputBytes.length; i++) {
		KLStdin.submitInput(inputBytes[i]);
	}
	KLFulfillPendingIoRequests();
}

function KLFulfillPendingIoRequests() {
	if (!KLJVMMainThread || KLJVMMainThread.state != KLTHREAD_STATE_WAITING) {
		return;
	}
	
	let ioRequest = KLJVMMainThread.pendingIoRequest;	
	if (ioRequest) {
		if (ioRequest.fd != KLFD_stdin) {
			debugger;
		}
		
		if (KLStdin.available() == 0) {
			return;
		}

		let availBytes = KLStdin.readBytes(ioRequest.len);
		for (let i = 0; i < availBytes.length; i++) {
			ioRequest.buffer.push(availBytes[i]);
		}
		ioRequest.completedLen = availBytes.length;
		KLJVMMainThread.state = KLTHREAD_STATE_RUNNING;
	}
}