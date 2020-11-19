// 
// native.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, jvm
//

var KLNativeImpls = {};

KLNativeImpls["java.lang.Class"] = {
	"registerNatives#()V": function() {	},
	"desiredAssertionStatus0#(Ljava.lang.Class;)Z": function() { 
		return JBooleanFalse;
	},
	"initClassName#()Ljava.lang.String;": function() {
		alert("Class name already init'd at creation. But we should do it here.");
	},
	"forName0#(Ljava.lang.String;ZLjava.lang.ClassLoader;Ljava.lang.Class;)Ljava.lang.Class;": function(thread, nameObj, initialize, loaderObj, callerObj) {
		// resolve the class by name internally.
		let className = JSStringFromJavaLangStringObj(nameObj);
		let c = ResolveClass(className);
		return JavaLangClassObjForClass(c);
	},
	"getPrimitiveClass#(Ljava.lang.String;)Ljava.lang.Class;": function(thread, nameObj) {
		let primitiveName = JSStringFromJavaLangStringObj(nameObj);
		return JavaLangClassObjForPrimitive(primitiveName);
	}
};

KLNativeImpls["java.lang.Object"] = {
	"getClass#()Ljava.lang.Class;": function(thread, jobj) {
		return JavaLangClassObjForClass(jobj.jclass);
	},
	"hashCode#()I": function() {
		return new JInt(1);
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
		let arrayClass = ResolveClass("[Ljava.lang.String;");
		let arr = new JArray(strClass, 4);
		arr.elements[0] = JavaLangStringObjForJSString("java.home");
		arr.elements[1] = JavaLangStringObjForJSString("/");
		return arr;
	},
	"platformProperties#()[Ljava.lang.String;": function() {
		// Pull out the number of props we need to supply.
		// let propsRawClass = ResolveClass("jdk.internal.util.SystemProps$Raw");
		// let maxPropsValue = propsRawClass.fieldValsByClass["jdk.internal.util.SystemProps$Raw"]["FIXED_LENGTH"];
		let arrayClass = ResolveClass("[Ljava.lang.String;");
		return new JArray(strClass, 42);
	}
};

KLNativeImpls["jdk.internal.misc.VM"] = {
	"initialize#()V": function() { },
	"getRandomSeedForCDSDump#()J": function() {
		let seed = new KLInt64([0, 0, 0, 0, 0, 0, 0, 1]);
		return new JLong(seed);
	},
	"initializeFromArchive#(Ljava.lang.Class;)V": function(thread, classObj) {
		// do nothing.
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

KLNativeImpls["java.lang.Float"] = {
	"floatToRawIntBits#(F)I": function(thread, f) {
		let floatVal = f.val;
		let bytes = toIEEE754Single(floatVal);
		let rawInt = ((bytes[0] << 24 ) | (bytes[1] << 16 ) |  (bytes[2] << 8 ) | bytes[3]) >>> 0;
		return new JInt(rawInt);
	}
};

KLNativeImpls["java.lang.Double"] = {
	"doubleToRawLongBits#(D)J": function(thread, d) {
		let doubleVal = d.val;
		let bytes = toIEEE754Double(doubleVal);
		let int64 = new KLInt64(bytes);
		return new JLong(int64);
	},
	"longBitsToDouble#(J)D": function(thread, l) {
		let bytes = l.val.storage;
		let d = fromIEEE754Double(bytes);
		return new JDouble(d);
	}	
};

KLNativeImpls["jdk.internal.reflect.Reflection"] = {
	"getCallerClass#()Ljava.lang.Class;": function(thread) {
		// Per the comment in the JDK:
		//   "Returns the class of the caller of the method calling this method,
        //    ignoring frames associated with java.lang.reflect.Method.invoke()
        //    and its implementation."
		// So, I think this is supposed to resturn the class of the caller of the caller.
		// Not sure how to think about Method.invoke but I guess will ignore that if seen.
		//
		let index = 0;
		let immediateCaller;
		do {
			index++;
			immediateCaller = thread.stack[index].method;
		} while (immediateCaller.class.name == "java.lang.reflect.Method" && immediateCaller.name == "invoke");
		index++;
		let priorCaller = thread.stack[index].method;
		while (priorCaller.class.name == "java.lang.reflect.Method" && priorCaller.name == "invoke") {
			index++;
			priorCaller = thread.stack[index].method;
		}
		let priorCallerClass = priorCaller.class;
		return JavaLangClassObjForClass(priorCallerClass);
	}
};