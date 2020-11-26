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
			console.log("JVM: Cannot load " + klclass.name + " before superclass " + klclass.superclassName);
			return;
		}
	
		klclass.superclass = superclass;
	}
	LoadedClasses.push(klclass);	
	console.log("JVM: Loaded class " + klclass.name);
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
		
	console.log("ERROR: Failed to resolve class " + className);
	return null;
}

function JavaLangStringObjForUTF16Bytes(bytes) {
	let ints = [];
    for (let i = 0; i < bytes.length; i++) {
		let intobj = new JInt(bytes[i]);
        ints.push(intobj);
    }
	let arrayClass = ResolveClass("[B");
	let byteArray = new JArray(arrayClass, ints.length);
	byteArray.elements = ints;
	let stringClass = ResolveClass("java.lang.String");
	stringObj = stringClass.createInstance();
	stringObj.fieldValsByClass["java.lang.String"]["value"] = byteArray;
	stringObj.fieldValsByClass["java.lang.String"]["coder"] = new JInt(0);  // = LATIN1 (each byte is one char)
	stringObj.state = JOBJ_STATE_INITIALIZED;
	return stringObj;
}

function JavaLangStringObjForJSString(jsStr) {
	let bytes = [];
    for (let i = 0; i < jsStr.length; i++) {
        bytes.push(jsStr.charCodeAt(i));
    }
	return JavaLangStringObjForUTF16Bytes(bytes);
}

function JSStringFromJavaLangStringObj(jobj) {
	if (!jobj || !jobj.class) { debugger; }
	
	if (jobj.class.name != "java.lang.String") {
		debugger;
	}
	let arrayref = jobj.fieldValsByClass["java.lang.String"]["value"];
	let jsstring = "";
	for (let i = 0; i < arrayref.elements.length; i++) {
		jsstring += String.fromCharCode(arrayref.elements[i].val);
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

function ResolveMethodReference(methodRef, contextClass) {
	// In general, we look for the method directly in the vtable of the contextClass, which is how overidden
	// methods are implemented here, with each subclass getting a full vtable of its whole inheritance chain.
	// The methodRef's class can also be an interface class if the method is a static method on the interface.
	if (!contextClass) {
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
		fieldClass = fieldClass.superclass;
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
	
	return { "name": fieldRef.fieldName, "class": fieldClass, "field": field };
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
		
		let fqmn = frame.method.class.name + "." + frame.method.name;
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
	let initPhase1Method = ResolveMethodReference({"className": "java.lang.System", "methodName": "initPhase1", "descriptor": "()V"});
	if (initPhase1Method) {
		let ctx = new KLThreadContext(initPhase1Method);
		ctx.exec();
		debugger;
	}
	
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