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
	},
	"isPrimitive#()Z": function(thread, classObj) {
		let primitiveName = classObj.meta.primitiveName;
		if (primitiveName) {
			return new JInt(1);
		} else {
			return new JInt(0);
		}
	},
	"isInterface#()Z": function(thread, classObj) {
		let classClass = classObj.meta.classClass;
		if (classClass && classClass.isInterface()) {
			return new JInt(1);
		} else {
			return new JInt(0);
		}
	},
	"getDeclaredConstructors0#(Z)[Ljava.lang.reflect.Constructor;": function(thread, classObj, publicObj) {
		// XXX This just returns an empty array, but this is not correct.
		let klclass = ResolveClass("[Ljava.lang.reflect.Constructor;");
		let jarray = new JArray(klclass, 0);
		return jarray;
	}
};

KLNativeImpls["java.lang.Object"] = {
	"getClass#()Ljava.lang.Class;": function(thread, jobj) {
		return JavaLangClassObjForClass(jobj.class);
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
	},
	"arraycopy#(Ljava.lang.Object;ILjava.lang.Object;II)V": function(thread, src, srcPos, dest, destPos, llength) {
		if (src.isa.isNull() || dest.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException");
			return; 
		}
		if (!src.isa.isArray() || !dest.isa.isArray()) {
			thread.throwException("java.lang.ArrayStoreException");
			return; 
		}
		if (!TypeIsAssignableToType(dest.isa.arrayComponentType(), src.isa.arrayComponentType())) {
			thread.throwException("java.lang.ArrayStoreException");
			return; 
		}
		let srcPosInt = srcPos.val;
		let destPosInt = destPos.val;
		let lengthInt = llength.val;
		if (srcPosInt < 0 || destPosInt < 0 || srcPosInt+lengthInt > src.count || destPosInt+lengthInt > dest.count) {
			thread.throwException("java.lang.IndexOutOfBoundsException");
			return; 
		}
		// Copy through intermediate which ensures correctness when src and dest are same. Obviously it's
		// not necessary in other cases. But who cares.
		let intermediate = []; 
		for (let i = 0; i < lengthInt; i++) {
			intermediate[i] = (src.elements[srcPosInt + i]);
		}
		for (let i = 0; i < lengthInt; i++) {
			dest.elements[destPosInt + i] = intermediate[i];
		}
	}
};

KLNativeImpls["java.lang.Runtime"] = {
	"availableProcessors#()I": function() {
		return new JInt(1);
	},
	"maxMemory#()J": function(thread) {
		// XXX We should be able to grab Long.MAX_VALUE here but it's not being set by Long's <clinit>
		// and I don't know why.
		let longMax = new KLInt64([0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
		return new JLong(longMax);
	}
};

KLNativeImpls["java.lang.Thread"] = {
	"registerNatives#()V": function() {	},
	"currentThread#()Ljava.lang.Thread;": function(thread) {
		return thread.currentJavaLangThreadObject();
	}, 
	"isAlive#()Z": function(thread, threadObj) {
		if (threadObj == thread.currentJavaLangThreadObject()) {
			return new JInt(1);
		}
		// Only the system thread is "alive". The JRE wants to create daemon threads
		// and we'll let it, but they don't do anything.
		return new JInt(0);
	},
	"setPriority0#(I)V": function() {
		// We don't keep meta state about the current (indeed any) thread, and this is a courtesy call
		// into the VM to keep us aware of the change that will have already happened in the field of
		// the Thread object.
	}
};

KLNativeImpls["jdk.internal.util.SystemProps$Raw"] = {
	"vmProperties#()[Ljava.lang.String;": function() { 
		let arrayClass = ResolveClass("[Ljava.lang.String;");
		let arr = new JArray(arrayClass, 6);
		arr.elements[0] = JavaLangStringObjForJSString("java.home");
		arr.elements[1] = JavaLangStringObjForJSString("/");
		arr.elements[2] = JavaLangStringObjForJSString("java.class.version");
		arr.elements[3] = JavaLangStringObjForJSString("52.0");  // This represents the SE8 version. 
		return arr;
	},
	"platformProperties#()[Ljava.lang.String;": function() {
		// Pull out the number of props we need to supply.
		// let propsRawClass = ResolveClass("jdk.internal.util.SystemProps$Raw");
		// let maxPropsValue = propsRawClass.fieldValsByClass["jdk.internal.util.SystemProps$Raw"]["FIXED_LENGTH"];
		let arrayClass = ResolveClass("[Ljava.lang.String;");
		return new JArray(arrayClass, 42);
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
	"registerNatives#()V": function() {	},
	"arrayBaseOffset0#(Ljava.lang.Class;)I": function() {
		return new JInt(0);
	},
	"arrayIndexScale0#(Ljava.lang.Class;)I": function() {
		return new JInt(0);
	},
	"objectFieldOffset1#(Ljava.lang.Class;Ljava.lang.String;)J": function(thread, unsafeObj, classObj, nameObj) {
		let klclass = classObj.meta.classClass;
		let fieldName = JSStringFromJavaLangStringObj(nameObj);
		let unsafeOffset = klclass.unsafeOffsetForInstanceField(fieldName);
		if (unsafeOffset < 0) {
			thread.throwException("java.lang.InternalError", "Unsafe.objectFieldOffset1: Invalid field " + 
				fieldName + " for instances of class " + klclass.name);
			return;
		}
		return new JLong(KLInt64FromNumber(unsafeOffset));
	},
	"compareAndSetReference#(Ljava.lang.Object;JLjava.lang.Object;Ljava.lang.Object;)Z": function(thread, unsafeObj, oObj, offsetObj, expectedObj, xObj) {
		let klclass = oObj.class;
		let offsetInt = offsetObj.val.lowWord();
		let fieldVal = oObj.unsafeGetFieldValForOffset(klclass, offsetInt);
		if (fieldVal == expectedObj) {
			oObj.unsafeSetFieldValForOffset(klclass, offsetInt, xObj);
			return new JInt(1);
		}
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

KLNativeImpls["java.lang.StringUTF16"] = {
	"isBigEndian#()Z": function() {
		return new JInt(1);
	}
};

KLNativeImpls["java.security.AccessController"] = {
	"getStackAccessControlContext#()Ljava.security.AccessControlContext;": function() {
		return new JNull(); // ???
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