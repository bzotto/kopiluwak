// 
// native.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
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
			return JBooleanTrue;
		} else {
			return JBooleanFalse;
		}
	},
	"isInterface#()Z": function(thread, classObj) {
		let classClass = classObj.meta.classClass;
		if (classClass && classClass.isInterface()) {
			return JBooleanTrue;
		} else {
			return JBooleanFalse;
		}
	},
	"isArray#()Z": function(thread, classObj) {
		let classClass = classObj.meta.classClass;
		if (classClass && classClass.isArray()) {
			return JBooleanTrue;
		} else {
			return JBooleanFalse;
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
	},
	"notifyAll#()V": function() {
		// nothing, since we only support one thread.
	}
};

KLNativeImpls["java.lang.Throwable"] = {
	"fillInStackTrace#(I)Ljava.lang.Throwable;": function(thread, throwableObj) {
		// XXX Implement me.
		return throwableObj;
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
	},
	// Stream chicanery: these set the standard streams that in Java-land look like final static null:
	"setIn0#(Ljava.io.InputStream;)V": function(thread, inputStreamObj) {
		let klclass = ResolveClass("java.lang.System");
		klclass.fieldVals["in"] = inputStreamObj;
	}, 
	"setOut0#(Ljava.io.PrintStream;)V": function(thread, outputStreamObj) {
		let klclass = ResolveClass("java.lang.System");
		klclass.fieldVals["out"] = outputStreamObj;
	}, 
	"setErr0#(Ljava.io.PrintStream;)V": function(thread, outputStreamObj) {
		let klclass = ResolveClass("java.lang.System");
		klclass.fieldVals["err"] = outputStreamObj;
	},
	"mapLibraryName#(Ljava.lang.String;)Ljava.lang.String;": function(thread, libnameObj) {
		let libname = JSStringFromJavaLangStringObj(libnameObj);
		let mappedName = JavaLangStringObjForJSString("KL->" + libname);
		return mappedName;
	},
	"identityHashCode#(Ljava.lang.Object;)I": function() {
		return new JInt(1);
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
			return JBooleanTrue;
		}
		// Only the system thread is "alive". The JRE wants to create daemon threads
		// and we'll let it, but they don't do anything.
		return JBooleanFalse;
	},
	"setPriority0#(I)V": function() {
		// We don't keep meta state about the current (indeed any) thread, and this is a courtesy call
		// into the VM to keep us aware of the change that will have already happened in the field of
		// the Thread object.
	},
	"start0#()V": function() {
		// Actually, don't start it!
	}
};

KLNativeImpls["jdk.internal.util.SystemProps$Raw"] = {
	"vmProperties#()[Ljava.lang.String;": function() { 
		let props = [];
		props.push(JavaLangStringObjForJSString("java.home"));
		props.push(JavaLangStringObjForJSString("/"));
		props.push(JavaLangStringObjForJSString("user.home"));
		props.push(JavaLangStringObjForJSString("/"));
		props.push(JavaLangStringObjForJSString("user.dir"));
		props.push(JavaLangStringObjForJSString("/"));
		props.push(JavaLangStringObjForJSString("user.name"));
		props.push(JavaLangStringObjForJSString("/"));
		props.push(JavaLangStringObjForJSString("java.io.tmpdir"));
		props.push(JavaLangStringObjForJSString("/"));	
		props.push(JavaLangStringObjForJSString("java.security.manager"));
		props.push(JavaLangStringObjForJSString("disallow"));	
		props.push(new JNull());
		props.push(new JNull());
			
		let arrayClass = ResolveClass("[Ljava.lang.String;");
		let arr = new JArray(arrayClass, props.length	);
		arr.elements = props;
		return arr;
	},
	"platformProperties#()[Ljava.lang.String;": function() {
		let arrayClass = ResolveClass("[Ljava.lang.String;");
		let props = new JArray(arrayClass, 42); // 
		props.elements[0] = JavaLangStringObjForJSString("javalandia"); // _display_country_NDX
		props.elements[1] = JavaLangStringObjForJSString(navigator.language); // _display_language_NDX
		props.elements[4] = JavaLangStringObjForJSString("UTF-8"); // _file_encoding_NDX
		props.elements[5] = JavaLangStringObjForJSString("/"); // _file_separator_NDX
		props.elements[19] = JavaLangStringObjForJSString("\n"); // _line_separator_NDX
 		props.elements[20] = JavaLangStringObjForJSString(navigator.platform); // _os_arch_NDX
 		props.elements[21] = JavaLangStringObjForJSString(navigator.appName); // _os_name_NDX
 		props.elements[22] = JavaLangStringObjForJSString(navigator.userAgent); // _os_version_NDX
 		props.elements[23] = JavaLangStringObjForJSString("/"); // _os_version_NDX
		props.elements[31] = JavaLangStringObjForJSString("UTF-8"); // _sun_io_unicode_encoding_NDX
		props.elements[32] = JavaLangStringObjForJSString("UTF-8"); // _sun_jnu_encoding_NDX
		props.elements[35] = JavaLangStringObjForJSString("UTF-8"); // _sun_stderr_encoding_NDX
		props.elements[36] = JavaLangStringObjForJSString("UTF-8"); // _sun_stdout_encoding_NDX
		
		
		return props;
	
		/* see jdk.internal.util.SystemProps for this ordered list:
		
        @Native private static final int _display_country_NDX = 0;
        @Native private static final int _display_language_NDX = 1 + _display_country_NDX;
        @Native private static final int _display_script_NDX = 1 + _display_language_NDX;
        @Native private static final int _display_variant_NDX = 1 + _display_script_NDX;
        @Native private static final int _file_encoding_NDX = 1 + _display_variant_NDX;
        @Native private static final int _file_separator_NDX = 1 + _file_encoding_NDX;
        @Native private static final int _format_country_NDX = 1 + _file_separator_NDX;
        @Native private static final int _format_language_NDX = 1 + _format_country_NDX;
        @Native private static final int _format_script_NDX = 1 + _format_language_NDX;
        @Native private static final int _format_variant_NDX = 1 + _format_script_NDX;
        @Native private static final int _ftp_nonProxyHosts_NDX = 1 + _format_variant_NDX;
        @Native private static final int _ftp_proxyHost_NDX = 1 + _ftp_nonProxyHosts_NDX;
        @Native private static final int _ftp_proxyPort_NDX = 1 + _ftp_proxyHost_NDX;
        @Native private static final int _http_nonProxyHosts_NDX = 1 + _ftp_proxyPort_NDX;
        @Native private static final int _http_proxyHost_NDX = 1 + _http_nonProxyHosts_NDX;
        @Native private static final int _http_proxyPort_NDX = 1 + _http_proxyHost_NDX;
        @Native private static final int _https_proxyHost_NDX = 1 + _http_proxyPort_NDX;
        @Native private static final int _https_proxyPort_NDX = 1 + _https_proxyHost_NDX;
        @Native private static final int _java_io_tmpdir_NDX = 1 + _https_proxyPort_NDX;
        @Native private static final int _line_separator_NDX = 1 + _java_io_tmpdir_NDX;
        @Native private static final int _os_arch_NDX = 1 + _line_separator_NDX;
        @Native private static final int _os_name_NDX = 1 + _os_arch_NDX;
        @Native private static final int _os_version_NDX = 1 + _os_name_NDX;
        @Native private static final int _path_separator_NDX = 1 + _os_version_NDX;
        @Native private static final int _socksNonProxyHosts_NDX = 1 + _path_separator_NDX;
        @Native private static final int _socksProxyHost_NDX = 1 + _socksNonProxyHosts_NDX;
        @Native private static final int _socksProxyPort_NDX = 1 + _socksProxyHost_NDX;
        @Native private static final int _sun_arch_abi_NDX = 1 + _socksProxyPort_NDX;
        @Native private static final int _sun_arch_data_model_NDX = 1 + _sun_arch_abi_NDX;
        @Native private static final int _sun_cpu_endian_NDX = 1 + _sun_arch_data_model_NDX;
        @Native private static final int _sun_cpu_isalist_NDX = 1 + _sun_cpu_endian_NDX;
        @Native private static final int _sun_io_unicode_encoding_NDX = 1 + _sun_cpu_isalist_NDX;
        @Native private static final int _sun_jnu_encoding_NDX = 1 + _sun_io_unicode_encoding_NDX;
        @Native private static final int _sun_os_patch_level_NDX = 1 + _sun_jnu_encoding_NDX;
        @Native private static final int _sun_stderr_encoding_NDX = 1 + _sun_os_patch_level_NDX;
        @Native private static final int _sun_stdout_encoding_NDX = 1 + _sun_stderr_encoding_NDX;
        @Native private static final int _user_dir_NDX = 1 + _sun_stdout_encoding_NDX;
        @Native private static final int _user_home_NDX = 1 + _user_dir_NDX;
        @Native private static final int _user_name_NDX = 1 + _user_home_NDX;
        @Native private static final int FIXED_LENGTH = 1 + _user_name_NDX;
		*/	
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
		return new JInt(1);
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
		
		let currentVal;
		if (klclass.isArray()) {
			currentVal = oObj.elements[offsetInt];
		} else {
			currentVal = oObj.unsafeGetFieldValForOffset(klclass, offsetInt);
		}
		if (!currentVal.isa.isReferenceType()) {
			debugger;
		}
		let bothNull = currentVal.isa.isNull() && expectedObj.isa.isNull();
		if (bothNull || currentVal == expectedObj) {
			if (klclass.isArray()) {
				oObj.elements[offsetInt] = xObj;
			} else {
				oObj.unsafeSetFieldValForOffset(klclass, offsetInt, xObj);
			}
			return JBooleanTrue;
		}
		return JBooleanFalse;
	},
	"compareAndSetInt#(Ljava.lang.Object;JII)Z": function(thread, unsafeObj, oObj, offsetObj, expectedObj, xObj) {
		let klclass = oObj.class;
		let offsetInt = offsetObj.val.lowWord();
		
		let currentVal;
		if (klclass.isArray()) {
			currentVal = oObj.elements[offsetInt];
		} else {
			currentVal = oObj.unsafeGetFieldValForOffset(klclass, offsetInt);
		}
		if (!currentVal.isa.isInt()) {
			debugger;
		}
		if (currentVal.val == expectedObj.val) {
			if (klclass.isArray()) {
				oObj.elements[offsetInt] = xObj;
			} else {
				oObj.unsafeSetFieldValForOffset(klclass, offsetInt, xObj);
			}
			return JBooleanTrue;
		}
		return JBooleanFalse;
	},
	"compareAndSetLong#(Ljava.lang.Object;JJJ)Z": function(thread, unsafeObj, oObj, offsetObj, expectedObj, xObj) {
		let klclass = oObj.class;
		let offsetInt = offsetObj.val.lowWord();
		
		let currentVal;
		if (klclass.isArray()) {
			currentVal = oObj.elements[offsetInt];
		} else {
			currentVal = oObj.unsafeGetFieldValForOffset(klclass, offsetInt);
		}
		if (!currentVal.isa.isLong()) {
			debugger;
		}
		if (currentVal.val.isEqualTo(expectedObj.val)) {
			if (klclass.isArray()) {
				oObj.elements[offsetInt] = xObj;
			} else {
				oObj.unsafeSetFieldValForOffset(klclass, offsetInt, xObj);
			}
			return JBooleanTrue;
		}
		return JBooleanFalse;
	},
	"storeFence#()V": function() {
		// nothing
	},
	"getReferenceVolatile#(Ljava.lang.Object;J)Ljava.lang.Object;": function(thread, unsafeObj, oObj, offsetObj) {
		let klclass = oObj.class;
		let offsetInt = offsetObj.val.lowWord();
		let currentVal;
		if (klclass.isArray()) {
			currentVal = oObj.elements[offsetInt];
		} else {
			currentVal = oObj.unsafeGetFieldValForOffset(klclass, offsetInt);
		}
		if (!currentVal.isa.isReferenceType()) {
			debugger;
		}
		return currentVal;
	},
	"putReferenceVolatile#(Ljava.lang.Object;JLjava.lang.Object;)V": function(thread, unsafeObj, oObj, offsetObj, xObj) {
		let klclass = oObj.class;
		let offsetInt = offsetObj.val.lowWord();
		if (!xObj.isa.isReferenceType()) {
			debugger;
		}
		if (klclass.isArray()) {
			oObj.elements[offsetInt] = xObj;
		} else {
			oObj.unsafeSetFieldValForOffset(klclass, offsetInt, xObj);
		}
	},
	"getIntVolatile#(Ljava.lang.Object;J)I": function(thread, unsafeObj, oObj, offsetObj) {
		let klclass = oObj.class;
		let offsetInt = offsetObj.val.lowWord();
		let currentVal;
		if (klclass.isArray()) {
			currentVal = oObj.elements[offsetInt];
		} else {
			currentVal = oObj.unsafeGetFieldValForOffset(klclass, offsetInt);
		}
		if (!currentVal.isa.isInt()) {
			debugger;
		}
		return currentVal;
	},
	"ensureClassInitialized0#(Ljava.lang.Class;)V": function(thread, unsafeObj, classObj) {
		let classClass = classObj.meta.classClass;
		let clinitFrame = CreateClassInitFrameIfNeeded(classClass);
		if (clinitFrame) {
			clinitFrame.method.class.state = KLCLASS_STATE_INITIALIZING;
			thread.pushFrame(clinitFrame);
		}
	}
};

KLNativeImpls["java.util.concurrent.atomic.AtomicLong"] = {
	"VMSupportsCS8#()Z": function() {
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
		return JBooleanTrue;
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
	},
	"getClassAccessFlags#(Ljava.lang.Class;)I": function(thread, classObj) {
		let classClass = classObj.meta.classClass;
		return new JInt(classClass.accessFlags);
	}
};

KLNativeImpls["java.io.FileDescriptor"] = {
	"initIDs#()V": function() {	},
	"getHandle#(I)J": function(thread, fdObj) {
		let intId = fdObj.val;
		switch (intId) {
		case 0:
			return new JLong(KLInt64FromNumber(KLFD_stdin));
		case 1:
			return new JLong(KLInt64FromNumber(KLFD_stdout));
		case 2:
			return new JLong(KLInt64FromNumber(KLFD_stderr));
		}
		return new JLong(KLInt64NegativeOne);
	},
	"getAppend#(I)Z": function(thread, fdObj) {
		return JBooleanTrue;
	}
};


// The following two streams are just always assumed to be stdin and stdout.
KLNativeImpls["java.io.FileInputStream"] = {
	"initIDs#()V": function() {	},
	"readBytes#([BII)I": function(thread, streamObj, bObj, offObj, lenObj) {
		let handle = KLIoHandleFromJavaIoFileInputStream(streamObj);
		if (handle != KLFD_stdin) {
			KLLogWarn("Can't read from any non-stdin handle");
			return new JInt(0);
		}
		
		// Have we been re-entered while waiting for input?
		if (thread.pendingIoRequest) {
			let ioRequest = thread.pendingIoRequest;
			thread.pendingIoRequest = null;
			let bytesCopied = ioRequest.completedLen;
			if (bytesCopied > lenObj.val) {
				debugger;
			}
			for (let i = 0; i < bytesCopied; i++) {
				bObj.elements[offObj.val + i] = new JInt(ioRequest.buffer[i]);
			}
			return new JInt(bytesCopied);
		} else {
			let ioRequest = new KLIoRequest(KLFD_stdin, lenObj.val);
			thread.waitForIoRequest(ioRequest);
			return;
		}		
	},
	"available0#()I": function(thread, streamObj) {
		let handle = KLIoHandleFromJavaIoFileInputStream(streamObj);
		if (handle != KLFD_stdin) {
			KLLogWarn("Can't read from any non-stdin handle");
			return new JInt(0);
		}
		
		let available = KLIoStdinImmediatelyAvailableBytes();
		return new JInt(available);
	}
};

KLNativeImpls["java.io.FileOutputStream"] = {
	"initIDs#()V": function() {	},
	"writeBytes#([BIIZ)V": function(thread, streamObj, bObj, offObj, lenObj, appendObj) {
		
		let handle = KLIoHandleFromJavaIoFileOutputStream(streamObj);
		if (handle != KLFD_stdout && handle != KLFD_stderr) {
			KLLogWarn("Can't write to non-std handle");
			return;
		}
		
		// For now assume these are ASCIIish strings. Make a JS string from the byte array.
		let offset = offObj.val;
		let len = lenObj.val;
		let outputStr = "";
		for (let i = offset; i < offset + len; i++) {
			let byte = bObj.elements[i].val;
			let ch = String.fromCharCode(byte);
			outputStr += ch;
		}
		if (handle == KLFD_stdout) {
			KLStdout.outputString(outputStr);
		} else if (handle == KLFD_stderr) {
			KLStderr.outputString(outputStr);
		}
	}
};

KLNativeImpls["jdk.internal.misc.Signal"] = {
	"findSignal0#(Ljava.lang.String;)I": function() {
		// No currently supported OS signals.
		return new JInt(-1);
	}
}

KLNativeImpls["java.io.UnixFileSystem"] = {
	"initIDs#()V": function() {	},
	"getBooleanAttributes0#(Ljava.io.File;)I": function() {
		return new JInt(0);
	}
};
	
KLNativeImpls["sun.nio.fs.UnixNativeDispatcher"] = {
	"init#()I": function() {
		return new JInt(0);
	},
	"getcwd#()[B": function() {
		let klclass = ResolveClass("[B");
		let jarray = new JArray(klclass, 1);
		jarray.elements[0] = new JInt('/');
		return jarray;
	}
}

KLNativeImpls["jdk.internal.loader.BootLoader"] = {
	"setBootLoaderUnnamedModule0#(Ljava.lang.Module;)V": function() {
		// nothing.
	}
}

KLNativeImpls["jdk.internal.loader.NativeLibraries"] = {
	"findBuiltinLib#(Ljava.lang.String;)Ljava.lang.String;": function() {
		return new JNull();
	}
}

KLNativeImpls["java.lang.reflect.Array"] = {
	"newArray#(Ljava.lang.Class;I)Ljava.lang.Object;": function(thread, classObj, lengthObj) {
		if (classObj.isa.isNull()) {
			thread.throwException("java.lang.NullPointerException", "Cannot create array of null component type");
			return;
		}
		let classClass = classObj.meta.classClass;
		let arrayClass = CreateArrayClassFromName("[" + classClass.type.descriptorString());
		let jarray = new JArray(arrayClass, lengthObj.val);
		return jarray;
	}
}
