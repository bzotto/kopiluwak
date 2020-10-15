// 
// jvm.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, classloader
//

// Resolved classes
var LoadedClasses = [];

function AddClass(loadedClass) {
	// Ensure that the superclass chain is already loaded.
	let current = loadedClass.superclassName;
	while (current) {
		let superclass = ResolveClass(current);
		if (!superclass) {
			console.log("JVM: Warning: Loading " + loadedClass.className + " without superclass " + current);
			break;
		}
		current = superclass.superclassName;
	}

	LoadedClasses.push(loadedClass);	
	console.log("JVM: Loaded class " + loadedClass.className);
}

function ResolveClass(className) {
	var jclass = null;
	for (var i = 0; i < LoadedClasses.length; i++) {
		var loadedClass = LoadedClasses[i];
		if (loadedClass.className == className) {
			jclass = loadedClass;
			break;
		}
	}
	
	if (jclass == null) {
		console.log("ERROR: Failed to resolve class " + className);
	}
	return jclass;
}

function ResolveMethodReference(methodInfo) {
	let jclass = ResolveClass(methodInfo.className);
	
	if (jclass == null) {
		console.log("ERROR: Failed to resolve class " + methodInfo.className);
		return {};
	}
	
	let methodIdentifier = methodInfo.methodName + "#" + methodInfo.descriptor;
	
	var methodRef = jclass.methods[methodIdentifier];
	
	if (!methodRef) {
		console.log("ERROR: Failed to resolve method " + methodInfo.methodName + " in " + methodInfo.className + " with descriptor " + methodInfo.descriptor);
		return {};
	} 
	
	return { "jclass": jclass, "method": methodRef };	
}

function ResolveFieldReference(fieldInfo) {
	let jclass = ResolveClass(fieldInfo.className);
	
	if (jclass == null) {
		console.log("ERROR: Failed to resolve class " + fieldInfo.className);
		return {};
	}
	
	var fieldRef = jclass.fields[fieldInfo.fieldName];
		
	if (!fieldRef || fieldRef.jtype.desc != fieldInfo.descriptor) {
		console.log("ERROR: Failed to resolve field " + fieldInfo.fieldName + " in " + fieldInfo.className + " with descriptor " + fieldInfo.descriptor);
		return {};
	}
	
	return { "jclass": jclass, "field": fieldRef };
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
	if (jobj.jclass.className == className) {
		return true;
	}
	let current = jobj.jclass;
	while (current.superclassName) {
		let superclassName = current.superclassName;
		current = ResolveClass(superclassName);
		if (current.className == className) {
			return true;
		}
	}
	
	// We ran out of superclasses
	return false;
}

// >= 0 means a target was found. negative values mean there is no target for this exception
function HandlerPcForException(jclass, currentPC, exceptionObj, exceptionTable) {
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
			let targetClassRef = jclass.loadedClass.constantPool[exceptionEntry.catch_type];
			let targetClassName = jclass.loadedClass.stringFromUtf8Constant(targetClassRef.name_index);
			if (ObjectIsA(exceptionObj, targetClassName)) {
				return exceptionEntry.handler_pc;
			}
		}
	}
	return -1;
}

function CreateStackFrame(jclass, method) {
	let frame = {};
	frame.jclass = jclass;
	frame.method = method;
	frame.pc = 0;
	frame.localVariables = [];
	frame.operandStack = [];
	frame.pendingException = null;
	return frame;
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
		let sourceFileName = frame.jclass.loadedClass.sourceFileName();
		
		let fqmn = frame.jclass.className.replace(/\//g, ".") + "." + frame.method.name;
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

function RunJavaThreadWithMethod(jclass, method) {
	var threadContext = {};
	threadContext.stack = [];
	
	// Create the bottom frame. We won't execute this immediately, but it will be set up to be returned to.
	let baseFrame = CreateStackFrame(jclass, method);
	threadContext.stack.unshift(baseFrame);
	
	// At the start of the thread, no classes have been initialized yet, trigger call to the <clinit> call for the current class.
	let methodReference = ResolveMethodReference({ "className": jclass.className, "methodName": "<clinit>", "descriptor": "()V" });
	let clinitFrame = CreateStackFrame(jclass, methodReference.method);	
	threadContext.stack.unshift(clinitFrame);
	
	while (threadContext.stack.length > 0) {
		var executeNewFrame = false;
		
		// Get reference to the top frame which we're currently running, and start executing.
		var frame = threadContext.stack[0];
		var code = frame.method.code;
		var pc = frame.pc;
		
		// Is there a pending exception waiting for us?
		if (frame.pendingException) {
			let exception = frame.pendingException;
			frame.pendingException = null;
			
			let handlerPC = HandlerPcForException(frame.jclass, pc, exception, frame.method.exceptions);
			if (handlerPC >= 0) {
				// We can handle this one. Blow away the stack and jump to the handler.
				pc = handlerPC;
				frame.operandStack = [exception];
			} else {
				// Nope. Kaboom.
				threadContext.stack.shift();
				threadContext.stack[0].pendingException = exception;
				continue;
			}
		} 		
		
		while (pc < code.length) {
			// update this before executing so it's present in case we want to dump the user stack
			frame.pc = pc;       
			
			var opcode = code[pc];
			var nextPc;
	
			switch (opcode) {
			case 0x02: // iconst_m1
			case 0x03: // iconst_0
			case 0x04: // iconst_1
			case 0x05: // iconst_2
			case 0x06: // iconst_3
			case 0x07: // iconst_4
			case 0x08: // iconst_5
				{
					let iconst = opcode - 3;
					frame.operandStack.push(iconst);
					nextPc = pc + 1;
					break;
				}
			case 0x10: // bipush
				{
					var byte = code[pc+1];
					frame.operandStack.push(byte);
					nextPc = pc + 2;
					break;
				}
			case 0x12: // ldc
				{
					var index = code[pc+1];
					var constref = frame.jclass.loadedClass.constantPool[index];
					var str = frame.jclass.loadedClass.stringFromUtf8Constant(constref.string_index);
					frame.operandStack.push(str);
					nextPc = pc + 2;
					break;
				}
			case 0x1A: // iload_0
				{
					frame.operandStack.push(frame.localVariables[0]);
					nextPc = pc + 1;
					break;
				}
			case 0x1B: // iload_1
				{
					frame.operandStack.push(frame.localVariables[1]);
					nextPc = pc + 1;
					break;
				}
			case 0x1C: // iload_2
				{
					frame.operandStack.push(frame.localVariables[2]);
					nextPc = pc + 1;
					break;
				}
			case 0x2A: // aload_0
				{
					frame.operandStack.push(frame.localVariables[0]);
					nextPc = pc + 1;
					break;
				}
			case 0x2B: // aload_1
				{
					frame.operandStack.push(frame.localVariables[1]);
					nextPc = pc + 1;
					break;
				}				
			case 0x2C: // aload_2
				{
					frame.operandStack.push(frame.localVariables[2]);
					nextPc = pc + 1;
					break;
				}
			case 0x3C: // istore_1
				{
					var ival = frame.operandStack.pop();
					frame.localVariables[1] = ival;
					nextPc = pc + 1;
					break;
				}
			case 0x3D: // istore_2
				{
					var ival = frame.operandStack.pop();
					frame.localVariables[2] = ival;
					nextPc = pc + 1;
					break;
				}
			case 0x4C: // astore_1
				{
					var aval = frame.operandStack.pop();
					frame.localVariables[1] = aval;
					nextPc = pc + 1;
					break;
				}
			case 0x4D: // astore_2
				{
					var aval = frame.operandStack.pop();
					frame.localVariables[2] = aval;
					nextPc = pc + 1;
					break;
				}
			case 0x59: // dup
				{
					var val = frame.operandStack.pop();
					frame.operandStack.push(val);
					frame.operandStack.push(val);
					nextPc = pc + 1;
					break;
				}
			case 0x60: // iadd
				{
					var add2 = frame.operandStack.pop();
					var add1 = frame.operandStack.pop();
					var res = add1 + add2;
					frame.operandStack.push(res);
					nextPc = pc + 1;
					break;
				}
			case 0x70: // irem
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					// this would be a good place to check for zero divisor and throw a runtime exception
					let result = value1 - (Math.trunc(value1 / value2)) * value2;
					frame.operandStack.push(result);
					nextPc = pc + 1;
					break;
				}
			case 0x84: // iinc
				{
					let index = code[pc+1];
					let c = code[pc+2];
					let val = frame.localVariables[index];
					val += c;
					frame.localVariables[index] = val;
					nextPc = pc + 3;
					break;
				}
			case 0xA0: // if_icmpne
				{
					let value2 = frame.operandStack.pop();
					let value1 = frame.operandStack.pop();
					if (value1 != value2) {
						let branchbyte1 = code[pc+1];
						let branchbyte2 = code[pc+2];
						let offset = Signed16bitValFromTwoBytes(branchbyte1, branchbyte2);
						nextPc = pc + offset; // probably want to bounds check this guy lol
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
					var ival = frame.operandStack.pop();
					// blow away all the other frame state.
					threadContext.stack.shift();
					// push the return value onto the caller's stack
					threadContext.stack[0].operandStack.push(ival);
					executeNewFrame = true;
					break;
				}
			case 0xB1: // return 
				{
					// blow away all the other frame state.
					threadContext.stack.shift();
					executeNewFrame = true;
					break;
				}
			case 0xB2: // getstatic
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// Resolve a static field for this index. 
					var fieldInfo = frame.jclass.loadedClass.fieldInfoFromIndex(index);
					var fieldRef = ResolveFieldReference(fieldInfo);  // returns {jclass, field reference}
					// Get the value of the static field:
					var fieldValue = fieldRef.jclass.fieldVals[fieldInfo.fieldName];
					frame.operandStack.push(fieldValue);
					nextPc = pc + 3;
					break;
				}
			case 0xB3: // putstatic
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// Resolve a static field for this index. 
					var fieldInfo = frame.jclass.loadedClass.fieldInfoFromIndex(index);
					var fieldRef = ResolveFieldReference(fieldInfo);  // returns {jclass, field reference}
					var fieldValue = frame.operandStack.pop();
					fieldRef.jclass.fieldVals[fieldInfo.fieldName] = fieldValue;
					nextPc = pc + 3;
					break;
				}
			case 0xB4: // getfield
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					var fieldInfo = frame.jclass.loadedClass.fieldInfoFromIndex(index);
					var fieldRef = ResolveFieldReference(fieldInfo);
					var jobj = frame.operandStack.pop();
					var val = jobj.fieldVals[fieldInfo.fieldName];
					frame.operandStack.push(val);
					nextPc = pc + 3;
					break;
				}
			case 0xB5: // putfield
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					var fieldInfo = frame.jclass.loadedClass.fieldInfoFromIndex(index);
					var fieldRef = ResolveFieldReference(fieldInfo);
					var val = frame.operandStack.pop();
					var jobj = frame.operandStack.pop();
					jobj.fieldVals[fieldInfo.fieldName] = val;
					nextPc = pc + 3;
					break;
				}
			case 0xB6: // invokevirtual
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					var methodInfo = frame.jclass.loadedClass.methodInfoFromIndex(index);
					var methodRef = ResolveMethodReference(methodInfo);  // returns {jclass, method reference}
					var nargs = methodRef.method.jmethod.parameterTypes.length;
					var args = frame.operandStack.slice(nargs * -1.0, frame.operandStack.length);
					var jobj = frame.operandStack[frame.operandStack.length - nargs - 1];
					args.unshift(jobj);
					
					if (methodRef.method.impl != null) {
						var rval = methodRef.method.impl.apply(null, args);
						nextPc = pc + 3;
					} else {
						let childFrame = CreateStackFrame(methodRef.jclass, methodRef.method);		
						childFrame.localVariables = args;
						
						// Save the current next-PC state.
						frame.pc = pc + 3;
					
						threadContext.stack.unshift(childFrame);
						// Break out of this execution loop.
						executeNewFrame = true;						
					}
				
					break;				
				}
			case 0xB7: // invokespecial
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					var methodInfo = frame.jclass.loadedClass.methodInfoFromIndex(index);
					var methodRef = ResolveMethodReference(methodInfo);  // returns {jclass, method reference}
					var nargs = methodRef.method.jmethod.parameterTypes.length;
					var args = frame.operandStack.slice(nargs * -1.0, frame.operandStack.length);
					var jobj = frame.operandStack[frame.operandStack.length - nargs - 1];
					args.unshift(jobj);
					
					if (methodRef.method.impl != null) {
						var rval = methodRef.method.impl.apply(null, args);
						nextPc = pc + 3;
					} else {
						let childFrame = CreateStackFrame(methodRef.jclass, methodRef.method);		
						childFrame.localVariables = args;
						
						// Save the current next-PC state.
						frame.pc = pc + 3;
					
						threadContext.stack.unshift(childFrame);
						// Break out of this execution loop.
						executeNewFrame = true;						
					}				
					break;
				}
			case 0xB8: // invokestatic
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// Resolve a static method for this index. 
					var methodInfo = frame.jclass.loadedClass.methodInfoFromIndex(index);
					var methodRef = ResolveMethodReference(methodInfo);  // returns {jclass, method reference}

					let childFrame = CreateStackFrame(methodRef.jclass, methodRef.method);		
					childFrame.localVariables = frame.operandStack.slice();
					
					// Save the current next-PC state.
					frame.pc = pc + 3;
					
					threadContext.stack.unshift(childFrame);
					// Break out of this execution loop.
					executeNewFrame = true;
					break;
				}
			case 0xBF: // athrow
				{
					let throwable = frame.operandStack.pop();
					if (!ObjectIsA(throwable, "java/lang/Throwable")) {
						console.log("JVM: Can't throw object of class " + throwable.jclass.className);
					}
					let handlerPc = HandlerPcForException(frame.jclass, pc, throwable, frame.method.exceptions);
					if (handlerPc >= 0) {
						nextPc = handlerPc;
						frame.operandStack = [throwable];
					} else {
						// This frame can't handle this exception, so blow it up, and stick
						// the exception object in the next frame down the stack and make *it* figure it out.
						threadContext.stack.shift();
						threadContext.stack[0].pendingException = throwable;
						executeNewFrame = true;
					}
					break;
				}
			case 0xBA: // invokedynamic
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// get the constant entry for the invokedynamic
					var cdynamic = frame.jclass.loadedClass.constantPool[index];
					var bootstrapIndex = cdynamic.bootstrap_method_attr_index;
					var bootstrapAttr = frame.jclass.loadedClass.attributeWithName("BootstrapMethods");
					var bootstrap = bootstrapAttr.bootstrap_methods[bootstrapIndex];
					var bootstrapMethodRef = bootstrap.bootstrap_method_ref;
					var bootstrapArgs = bootstrap.bootstrap_arguments;
					var methodHandle = frame.jclass.loadedClass.constantPool[bootstrapMethodRef];
					if (methodHandle.reference_kind == REF_invokeStatic) {
						// We expect the other field in the handle to reference a methodrefinfo
						var methodRefInfo = frame.jclass.loadedClass.methodInfoFromIndex(methodHandle.reference_index);
						var methodRef = ResolveMethodReference(methodRefInfo);  // returns {jclass, method reference}
						
						
					} else {
						// ¯\_(ツ)_/¯ 
					}
					
					
					break;
				}
			case 0xBB: // new
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					var classRef = frame.jclass.loadedClass.constantPool[index];
					var className = frame.jclass.loadedClass.stringFromUtf8Constant(classRef.name_index);
					var jclass = ResolveClass(className);
					var jObj = jclass.createInstance();
					frame.operandStack.push(jObj);
					nextPc = pc + 3;
					break;
				}
			default:
				console.log("UNSUPPORTED OPCODE " + opcode + " at PC = " + pc);
				return 0;
			}
			
			if (executeNewFrame) {
				executeNewFrame = false;
				break;
			}
			pc = nextPc;
		}
				
	}
	console.log("JVM: Java thread exited successfully.");
	return 0;
}

function JClassFromLoadedClass(loadedClass) {
	let jclass = new JClass(loadedClass);
	
	// Walk the methods in the class and patch them up.
	for (let i = 0; i < loadedClass.methods.length; i++) {
		let method = loadedClass.methods[i];
		let name = loadedClass.stringFromUtf8Constant(method.name_index);
		let desc = loadedClass.stringFromUtf8Constant(method.descriptor_index);
		let access_flags = method.access_flags;
		
		// Is there code?	
		let codeAttr = null;
		for (var j = 0; j < method.attributes.length; j++) {
			let attr = method.attributes[j];
			let attrname = loadedClass.stringFromUtf8Constant(attr.attribute_name_index);
			if (attrname == "Code") {
				codeAttr = attr;
				break;
			}
		}
		
		let methodIdentifier = name + "#" + desc;
		
		// Find a line number table if one exists.
		let lineNumberTable = null;
		if (codeAttr && codeAttr.attributes) {
			for (let j = 0; j < codeAttr.attributes.length; j++) {
				let attr = codeAttr.attributes[j];
				let attrname = loadedClass.stringFromUtf8Constant(attr.attribute_name_index);
				if (attrname == "LineNumberTable") {
					lineNumberTable = attr.line_number_table;
					break;
				}
			}
		}
		
		jclass.methods[methodIdentifier] = { 
			"name": name, 
			"jmethod": new JMethod(desc), 
			"access": access_flags, 
			"impl": null, 
			"code": codeAttr ? codeAttr.code : null,
			"exceptions": codeAttr ? codeAttr.exception_table : null,
			"lineNumbers": lineNumberTable 
		};
	}
	
	// Walk the fields in the class and patch them up!
	for (var i = 0; i < loadedClass.fields.length; i++) {
		var field = loadedClass.fields[i];
		var name = loadedClass.stringFromUtf8Constant(field.name_index);
		var desc = loadedClass.stringFromUtf8Constant(field.descriptor_index);
		var access_flags = field.access_flags;
		
		jclass.fields[name] = { "jtype": new JType(desc), "access": access_flags };
	}
	
	return jclass;
}

function InjectOutputMockObjects() {
	
	// Object
	var javaLangObjectLoadedClass = new JLoadedClass("java/lang/Object", null, [], [], [], []);
	var javaLangObjectJclass = new JClass(javaLangObjectLoadedClass);
	javaLangObjectJclass.methods["<init>#()V"] = { "name": "<init>", "jmethod": new JMethod("()V"), "access": ACC_PUBLIC, "code": null, "impl": 
		function(jobj) {
			console.log("java.lang.Object <init> invoked");
		}
	};
	AddClass(javaLangObjectJclass);
	
	// Throwable and Exception
	var javaLangThrowableLoadedClass = new JLoadedClass("java/lang/Throwable", "java/lang/Object", [], [], [], []);
	var javaLangThrowableJClass = new JClass(javaLangThrowableLoadedClass);
	AddClass(javaLangThrowableJClass);
	
	var javaLangExceptionLoadedClass = new JLoadedClass("java/lang/Exception", "java/lang/Throwable", [], [], [], []);
	var javaLangExceptionJClass = new JClass(javaLangExceptionLoadedClass);
	javaLangExceptionJClass.methods["<init>#()V"] = { "name": "<init>", "jmethod": new JMethod("()V"), "access": ACC_PUBLIC, "code": null, "impl": 		
	function(jobj) {
			console.log("java.lang.Exception <init> invoked");
		}
	}
	AddClass(javaLangExceptionJClass);
	
	// Stuff that lets us print stuff to the console. 
	var javaIoPrintStreamLoadedClass = new JLoadedClass("java/io/PrintStream", "java/io/FilterOutputStream", [], [], [], []);
	var javaIoPrintStreamJclass = new JClass(javaIoPrintStreamLoadedClass);
	javaIoPrintStreamJclass.methods["println#(Ljava/lang/String;)V"] = { "name": "println", "jmethod": new JMethod("(Ljava/lang/String;)V"), "access": ACC_PUBLIC, "code": null, "impl": 
		function(jobj, x) { 
			console.log(x);
		}
	};
	javaIoPrintStreamJclass.methods["println#(I)V"] = { "name": "println", "jmethod": new JMethod("(I)V"), "access": ACC_PUBLIC, "code": null, "impl": 
		function(jobj, x) { 
			console.log(x);
		}
	};
	AddClass(javaIoPrintStreamJclass);
	var systemOutStreamObj = javaIoPrintStreamJclass.createInstance();
	
	var javaLangSystemLoadedClass = new JLoadedClass("java/lang/System", "java/lang/Object", [], [], [], []);
	var javaLangSystemJclass = new JClass(javaLangSystemLoadedClass);
	javaLangSystemJclass.fields["out"] = { "jtype": new JType("Ljava/io/PrintStream;"), "access": ACC_PUBLIC|ACC_STATIC, "value": systemOutStreamObj};
	AddClass(javaLangSystemJclass);
}

function LoadClassAndExecute(mainClassHex, otherClassesHex) {
	
	// Inject system crap so we don't need JDK for super simple tests
	InjectOutputMockObjects();

	// Load the main class
	let classLoader = new KLClassLoader();
	let clresult = classLoader.loadFromHexString(mainClassHex);
	if (clresult.error) {
		return clresult.error;
	}
	let loadedClass = clresult.loadedClass;
	let jclass = JClassFromLoadedClass(loadedClass);
	AddClass(jclass);
	let mainClass = jclass;
	
	// Load any auxiliary classes on offer.
	for (let i = 0; i < otherClassesHex.length; i++) {
		clresult = classLoader.loadFromHexString(otherClassesHex[i]);
		if (clresult.error) {
			return "error loading aux class " + i + "" + clresult.error;
		}
		jclass = JClassFromLoadedClass(clresult.loadedClass);
		AddClass(jclass);
	}
	
	var mainmethod = mainClass.mainEntryPointMethod();
	if (mainmethod) {
		RunJavaThreadWithMethod(mainClass, mainmethod);
	} else {
		return "Didn't find main method entry point"
	}
	return "";	
}