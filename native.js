// 
// native.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, jvm
//


// Utility routine
function JsStringFromJavaStringObject(javaString) {
	if (javaString.jclass.className != "java/lang/String") {
		alert("Bad native string handling.");
		return "";
	}
	let bytesJArray = javaString.fieldValsByClass["java/lang/String"]["value"];
	return String.fromCharCode.apply(null, bytesJArray.elements);
}

var KLNativeImpls = {};

KLNativeImpls["java/lang/Class"] = {
	"initClassName#()Ljava/lang/String;": function(jobj) {
		alert("Class name already init'd at creation. But we should do it here.");
	},
	"forName0#(Ljava/lang/String;ZLjava/lang/ClassLoader;Ljava/lang/Class;)Ljava/lang/Class;": function(nameObj, initialize, loaderObj, callerObj) {
		// resolve the class by name internally.
		let className = JsStringFromJavaStringObject(nameObj);
		let c = ResolveClass(className);
		return JavaLangClassObjForClass(c);
	}
};

KLNativeImpls["java/lang/Object"] = {
	"getClass#()Ljava/lang/Class;": function(jobj) {
		return JavaLangClassObjForClass(jobj.jclass);
	},
	"hashCode#()I": function() {
		return 1;
	}
};

KLNativeImpls["jdk/internal/util/SystemProps$Raw"] = {
	"vmProperties#()[Ljava/lang/String;": function() { 
		let strClass = ResolveClass("java/lang/String");
		let arr = new JArray(strClass, 4);
		arr.elements[0] = "java.home";
		arr.elements[1] = "/";
		return arr;
	},
	"platformProperties#()[Ljava/lang/String;": function() { 
		let strClass = ResolveClass("java/lang/String");
		return new JArray(strClass, 2);
	}
};