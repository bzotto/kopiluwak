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
		return JavaLangClassObjForPrimitive(primitiveName);
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
	"registerNatives#()V": function() {	},
	"nanoTime#()J": function() {
		let milliseconds = performance.now();
		let nanoseconds = Math.trunc(milliseconds * 1000000);
		let int64 = KLInt64FromNumber(nanoseconds);
		return new JLong(int64);
	}
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
		// Pull out the number of props we need to supply.
		// let propsRawClass = ResolveClass("jdk.internal.util.SystemProps$Raw");
		// let maxPropsValue = propsRawClass.fieldValsByClass["jdk.internal.util.SystemProps$Raw"]["FIXED_LENGTH"];
		let strClass = ResolveClass("java.lang.String");
		return new JArray(strClass.typeOfInstances, 42);
	}
};

KLNativeImpls["jdk.internal.misc.Unsafe"] = {
	"arrayBaseOffset0#(Ljava.lang.Class;)I": function() {
		return new JInt(0);
	},
	"arrayIndexScale0#(Ljava.lang.Class;)I": function() {
		return new JInt(0);
	}
};