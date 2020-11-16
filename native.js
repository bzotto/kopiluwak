// 
// native.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, jvm
//


// Utility routine

var KLNativeImpls = {};

KLNativeImpls["java.lang.Class"] = {
	"registerNatives#()V": function() {	},
	"desiredAssertionStatus0#(Ljava.lang.Class;)Z": function() { 
		return JBooleanFalse;
	},
	"initClassName#()Ljava.lang.String;": function(jobj) {
		alert("Class name already init'd at creation. But we should do it here.");
	},
	"forName0#(Ljava.lang.String;ZLjava.lang.ClassLoader;Ljava.lang.Class;)Ljava.lang.Class;": function(nameObj, initialize, loaderObj, callerObj) {
		// resolve the class by name internally.
		let className = JSStringFromJavaLangStringObj(nameObj);
		let c = ResolveClass(className);
		return JavaLangClassObjForClass(c);
	},
	"getPrimitiveClass#(Ljava.lang.String;)Ljava.lang.Class;": function(nameObj) {
		let primitiveName = JSStringFromJavaLangStringObj(nameObj);
		if (primitiveName == "int") {
			let c = ResolveClass("java.lang.Integer");
			return JavaLangClassObjForClass(c);
		} else if (primitiveName == "float") {
			let c = ResolveClass("java.lang.Float");
			return JavaLangClassObjForClass(c);
		} else {
			debugger;
			return new JNull();
			}
	}
};

KLNativeImpls["java.lang.Object"] = {
	"getClass#()Ljava.lang.Class;": function(jobj) {
		return JavaLangClassObjForClass(jobj.jclass);
	},
	"hashCode#()I": function() {
		return new JInt(1)
	}
};

KLNativeImpls["java.lang.System"] = {
	"registerNatives#()V": function() {	}
};

KLNativeImpls["jdk.internal.util.SystemProps$Raw"] = {
	"vmProperties#()[Ljava.lang.String;": function() { 
		let strClass = ResolveClass("java.lang.String");
		let arr = new JArray(strClass.typeOfInstances, 4);
		arr.elements[0] = JavaLangStringObjForJSString("java.home");
		arr.elements[1] = JavaLangStringObjForJSString("/");
		return arr;
	},
	"platformProperties#()[Ljava.lang.String;": function() { 
		let strClass = ResolveClass("java.lang.String");
		return new JArray(strClass.typeOfInstances, 42);
	}
};