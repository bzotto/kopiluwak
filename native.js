// 
// native.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, jvm
//

var KLNativeImpls = {};

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
}