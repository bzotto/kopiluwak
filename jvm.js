const {
	JLoadedClass,
	JClass,
	JObj,
} = require('./objects');

const {
	JMethod,
	JType,
} = require('./types');

const {
	ACC_PUBLIC,
	ACC_PRIVATE,
	ACC_PROTECTED,
	ACC_STATIC,
	ACC_FINAL,
	ACC_SYNCHRONIZED,
	ACC_BRIDGE,
	ACC_VARARGS,
	ACC_NATIVE,
	ACC_ABSTRACT,
	ACC_STRICT,
	ACC_SYNTHETIC,
} = require('./access-flags');

//
// Constant pool tags
// 

const CONSTANT_Class = 7;
const CONSTANT_Fieldref	= 9;
const CONSTANT_Methodref = 10;
const CONSTANT_InterfaceMethodref = 11;
const CONSTANT_String = 8;
const CONSTANT_Integer = 3;
const CONSTANT_Float = 4;
const CONSTANT_Long	= 5;
const CONSTANT_Double = 6;
const CONSTANT_NameAndType = 12;
const CONSTANT_Utf8	= 1;
const CONSTANT_MethodHandle	= 15;
const CONSTANT_MethodType = 16;
const CONSTANT_InvokeDynamic = 18;

//
// Method handle kinds
//

const REF_getField = 1;
const REF_getStatic	= 2;
const REF_putField = 3;
const REF_putStatic = 4;
const REF_invokeVirtual = 5;
const REF_invokeStatic = 6;
const REF_invokeSpecial	= 7;
const REF_newInvokeSpecial = 8;
const REF_invokeInterface = 9;

// 
// Utility routines
//
function hex2bytes(hex) {
	var trimmed = hex.replace(/\s/g,'');
	var chars = trimmed.match(/.{1,2}/g);
	return chars.map(function(h) { return parseInt(h, 16) });
}

function utf8ToString(uintArray) {
    var encodedString = String.fromCharCode.apply(null, uintArray),
        decodedString = decodeURIComponent(escape(atob(encodedString)));
    return decodedString;
}
function utf16ToString(uintArray) {
    return String.fromCharCode.apply(null, uintArray);
}

// Source bytecode stream
var JavaClassFile = [];
var JavaClassFileIdx = 0;
// Resolved classes
var LoadedClasses = [];

// Constant Pool
var ConstantPool = []; // a 1-indexed array of objects, all of which have a "tag" key.
var Methods = [];
var Attributes = [];
var Fields = [];

var ParseErrorString = null;

//
// Class file parse routines
//

function StringFromUtf8Constant(index) {
	var c = ConstantPool[index];
	if (c["tag"] != CONSTANT_Utf8) {
		console.log("Internal error: constant index " + index + " is not a UTF8.");
		return;
	}
	var str = utf16ToString(c["bytes"]);  // XXX: should be utf8ToString, which doesn't work rn.
	return str;
}

function ReadU1() {
	return JavaClassFile[JavaClassFileIdx++];
}

function ReadU2() {
	var hi = JavaClassFile[JavaClassFileIdx++];
	var lo = JavaClassFile[JavaClassFileIdx++];
	return ((hi << 8) | lo) >>> 0;
}

function ReadU4() {
	var one = JavaClassFile[JavaClassFileIdx++];
	var two = JavaClassFile[JavaClassFileIdx++];
	var three = JavaClassFile[JavaClassFileIdx++];
	var four = JavaClassFile[JavaClassFileIdx++];	
	return ((one << 24 ) | (two << 16 ) |  (three << 8 ) | four) >>> 0;
}

function ReadU1Array(len) {
	var arr = [];
	for (var i = 0; i < len; i++) {
		arr.push(ReadU1());
	}
	return arr;
}

function SkipReadBytes(len) {
	JavaClassFileIdx += len;
}

function ReadCpInfo() {
	var tag = ReadU1();
	var info = { "tag" : tag };
	switch (tag) {
		case CONSTANT_Methodref:
			{
				info["class_index"] = ReadU2();
				info["name_and_type_index"] = ReadU2();				
				break;
			}
		case CONSTANT_Class:
			{
				info["name_index"] = ReadU2();
				break;
			}
		case CONSTANT_NameAndType:
			{
				info["name_index"] = ReadU2();
				info["descriptor_index"] = ReadU2();
				break;
			}
		case CONSTANT_Utf8:
			{
				var len = ReadU2();
				var utf8 = ReadU1Array(len);
				info["length"] = len;
				info["bytes"] = utf8;
				break;
			}
		case CONSTANT_Fieldref:
			{
				info["class_index"] = ReadU2();
				info["name_and_type_index"] = ReadU2();				
				break;
			}
		case CONSTANT_String:
			{
				info["string_index"] = ReadU2();
				break;
			}
		case CONSTANT_InvokeDynamic:
			{
				info["bootstrap_method_attr_index"] = ReadU2();
				info["name_and_type_index"] = ReadU2();
				break;
			}
		case CONSTANT_MethodHandle:
			{
				info["reference_kind"] = ReadU1();
				info["reference_index"] = ReadU2();
				break;
			}
	default:
		ParseErrorString = "Unknown constant pool tag " + tag;
		return null;
	}
	
	return info;
}

function ReadConstantPool(constant_pool_count) {
	var index;
	for (index = 1; index < constant_pool_count; index++) {
		var cp_info = ReadCpInfo();
		if (cp_info) {
			ConstantPool[index] = cp_info;
		} else {
			return;
		}
	}
}

function ReadAttributeInfo() {
	var info = {};
	info["attribute_name_index"] = ReadU2();
	var attribute_length = ReadU4();
	info["attribute_length"] = attribute_length;
	
	// We should be able to look up a name here because the constant pool should already be parsed.
	var name = StringFromUtf8Constant(info["attribute_name_index"]);
	if (name == "Code") {
		info["max_stack"] = ReadU2();
		info["max_locals"] = ReadU2();
		var code_length = ReadU4();
		info["code_length"] = code_length;
		info["code"] = ReadU1Array(code_length);
		var exception_table_length = ReadU2();
		for (var i = 0; i < exception_table_length; i++) {
			// XXX
			SkipReadBytes(8);
		}
		var attributes_count = ReadU2();
		var code_attributes = [];
		for (var i = 0; i < attributes_count; i++) {
			var code_attribute = ReadAttributeInfo();
			code_attributes.push(code_attribute);
		}
		info["attributes"] = code_attributes;
	} else if (name == "BootstrapMethods") {
		var num_bootstrap_methods = ReadU2();
		var bootstrap_methods = [];
		for (var i = 0; i < num_bootstrap_methods; i++) {
			var bootstrap_method = {};
			bootstrap_method["bootstrap_method_ref"] = ReadU2();
			var num_bootstrap_arguments = ReadU2();
			var bootstrap_arguments = [];
			for (var j = 0; j < num_bootstrap_arguments; j++) {
				bootstrap_arguments.push(ReadU2());
			}
			bootstrap_method["bootstrap_arguments"] = bootstrap_arguments;
			bootstrap_methods.push(bootstrap_method);
		}
		info["bootstrap_methods"] = bootstrap_methods;
	} else {
		info["info"] = ReadU1Array(attribute_length);
	}
	return info;
}

function ReadMethodOrFieldInfo() {
	var info = {};
	info["access_flags"] = ReadU2();
	info["name_index"] = ReadU2();
	info["descriptor_index"] = ReadU2();
	var attributes_count = ReadU2();
	info["attributes_count"] = attributes_count;
	var attributes = [];
	for (var i = 0; i < attributes_count; i++) {
		var attribute = ReadAttributeInfo();
		if (attribute) {
			attributes.push(attribute);
		} else {
			break;
		}
	}
	info["attributes"] = attributes;
	return info;
}

function ReadFields(fields_count) {
	var index;
	for (index = 0; index < fields_count; index++) {
		var field_info = ReadMethodOrFieldInfo();
		if (field_info) {
			Fields[index] = field_info;
		} else {
			return;
		}
	}
}

function ReadMethods(methods_count) {
	var index;
	for (index = 0; index < methods_count; index++) {
		var method_info = ReadMethodOrFieldInfo();
		if (method_info) {
			Methods[index] = method_info;
		} else {
			return;
		}
	}
}

function ReadAttributes(attributes_count) {
	var index;
	for (index = 0; index < attributes_count; index++) {
		var attribute_info = ReadAttributeInfo();
		if (attribute_info) {
			Attributes[index] = attribute_info;
		} else {
			return;
		}
	}
}


function NameForClass(classIndex) {
	var c = ConstantPool[classIndex];
	if (c["tag"] != CONSTANT_Class) {
		console.log("Internal error: constant index " + classIndex + " is not a class.");
		return;
	}
	var name_index = c["name_index"];
	return StringFromUtf8Constant(name_index);
}

function FieldRefForIndex(classObj, index) {
	var c = classObj.cp[index];
	if (c["tag"] != CONSTANT_Fieldref) {
		console.log("Invalid field ref error: constant index " + index + " is not a field ref.");
		return;
	}
	return c;
}

function MethodRefForIndex(index) {
	var c = ConstantPool[index];
	if (c["tag"] != CONSTANT_Methodref) {
		console.log("Invalid method ref error: constant index " + index + " is not a method ref.");
		return;
	}
	return c;
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
	var jclass = null;
	for (var i = 0; i < LoadedClasses.length; i++) {
		var loadedClass = LoadedClasses[i];
		if (loadedClass.className == methodInfo.className) {
			jclass = loadedClass;
			break;
		}
	}
	
	if (jclass == null) {
		console.log("ERROR: Failed to resolve class " + methodInfo.className);
		return {};
	}
	
	var methodRef = jclass.methods[methodInfo.methodName];
	
	if (!methodRef) {
		console.log("ERROR: Failed to resolve method " + methodInfo.methodName + " in class " + methodInfo.className );
		return {};
	} 
	
	if (methodRef.jmethod.desc != methodInfo.descriptor) {
		console.log("ERROR: Failed to resolve method " + methodInfo.methodName + " in " + methodInfo.className + " with descriptor " + methodInfo.descriptor);
		return {};
	}
	
	return { "jclass": jclass, "method": methodRef };	
}

function ResolveFieldReference(fieldInfo) {
	var jclass = null;
	for (var i = 0; i < LoadedClasses.length; i++) {
		var loadedClass = LoadedClasses[i];
		if (loadedClass.className == fieldInfo.className) {
			jclass = loadedClass;
			break;
		}
	}
	
	if (jclass == null) {
		console.log("ERROR: Failed to resolve class " + fieldInfo.className);
		return {};
	}
	
	var fieldRef = jclass.fields[fieldInfo.fieldName];
	
	if (!fieldRef) {
		console.log("ERROR: Failed to resolve method " + fieldInfo.fieldName + " in class " + fieldInfo.className );
		return {};
	} 
	
	if (fieldRef.jtype.desc != fieldInfo.descriptor) {
		console.log("ERROR: Failed to resolve field " + fieldInfo.fieldName + " in " + fieldInfo.className + " with descriptor " + fieldInfo.descriptor);
		return {};
	}
	
	return { "jclass": jclass, "field": fieldRef };
}


function RunJavaThreadWithMethod(jclass, method) {
	var threadContext = {};
	threadContext.stack = [];
	
	// Create the bottom frame. We won't execute this immediately, but it will be set up to be returned to.
	var baseFrame = {};
	baseFrame.jclass = jclass;
	baseFrame.method = method;
	baseFrame.pc = 0;
	baseFrame.localVariables = [];
	baseFrame.operandStack = [];
	
	threadContext.stack.unshift(baseFrame);
	
	// At the start of the thread, no classes have been initialized yet, trigger call to the <clinit> call for the current class.
	var clinitFrame = {};
	clinitFrame.jclass = jclass;
	var methodReference = ResolveMethodReference({ "className": jclass.className, "methodName": "<clinit>", "descriptor": "()V" });
	clinitFrame.method = methodReference.method;
	clinitFrame.pc = 0;
	clinitFrame.localVariables = [];
	clinitFrame.operandStack = [];
	threadContext.stack.unshift(clinitFrame);
	
	while (threadContext.stack.length > 0) {
		
		// Get reference to the top frame which we're currently running, and start executing.
		var frame = threadContext.stack[0];
		var code = frame.method.code;
		var pc = frame.pc;
		
		var executeNewFrame = false;
		
		while (pc < code.length) {
			var opcode = code[pc];
			var nextPc;
	
			switch (opcode) {
			case 0x06: // iconst_3
				{
					frame.operandStack.push(3);
					nextPc = pc + 1;
					break;
				}
			case 0x07: // iconst_4
				{
					frame.operandStack.push(4);
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
					var add1 = frame.operandStack.pop();
					var add2 = frame.operandStack.pop();
					var res = add1 + add2;
					frame.operandStack.push(res);
					nextPc = pc + 1;
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
			case 0x12: // ldc
				{
					var index = code[pc+1];
					var constref = frame.jclass.loadedClass.constantPool[index];
					var str = frame.jclass.loadedClass.stringFromUtf8Constant(constref.string_index);
					frame.operandStack.push(str);
					nextPc = pc + 2;
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
			case 0xBA: // invokedynamic
				{
					var indexbyte1 = code[pc+1];
					var indexbyte2 = code[pc+2];
					var index = ((indexbyte1 << 8) | indexbyte2) >>> 0;
					// get the constant entry for the invokedynamic
					var cdynamic = frame.jclass.loadedClass.constantPool[index];
					var bootstrapIndex = cdynamic.bootstrap_method_attr_index;
					var bootstrapAttr = frame.jclass.loadedClass.bootstrapMethodsAttribute();
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
						var childFrame = {};
						childFrame.jclass = methodRef.jclass;
						childFrame.method = methodRef.method;
						childFrame.pc = 0;
						childFrame.localVariables = args;
						childFrame.operandStack = [];
					
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
						var childFrame = {};
						childFrame.jclass = methodRef.jclass;
						childFrame.method = methodRef.method;
						childFrame.pc = 0;
						childFrame.localVariables = args;
						childFrame.operandStack = [];
					
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

					var childFrame = {};
					childFrame.jclass = methodRef.jclass;
					childFrame.method = methodRef.method;
					childFrame.pc = 0;
					childFrame.localVariables = frame.operandStack.slice();
					childFrame.operandStack = [];
					
					// Save the current next-PC state.
					frame.pc = pc + 3;
					
					threadContext.stack.unshift(childFrame);
					// Break out of this execution loop.
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
	var jclass = new JClass(loadedClass);
	
	// Walk the methods in the class and patch them up.
	for (var i = 0; i < loadedClass.methods.length; i++) {
		var method = loadedClass.methods[i];
		var name = loadedClass.stringFromUtf8Constant(method.name_index);
		var desc = loadedClass.stringFromUtf8Constant(method.descriptor_index);
		var access_flags = method.access_flags;
		
		// Is there code?	
		var code = null;
		for (var j = 0; j < method.attributes.length; j++) {
			var attr = method.attributes[j];
			var attrname = loadedClass.stringFromUtf8Constant(attr.attribute_name_index);
			if (attrname == "Code") {
				code = attr.code;
				break;
			}
		}
		jclass.methods[name] = { "jmethod": new JMethod(desc), "access": access_flags, "impl": null, "code": code };
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

	var javaLangObjectLoadedClass = new JLoadedClass("java/lang/Object", null, [], [], [], []);
	var javaLandObjectJclass = new JClass(javaLangObjectLoadedClass);
	javaLandObjectJclass.methods["<init>"] = { "jmethod": new JMethod("()V"), "access": ACC_PUBLIC, "code": null, "impl": 
		function(jobj) {
			console.log("java.lang.Object <init> invoked");
		}
	};
	LoadedClasses.push(javaLandObjectJclass);
	
	var javaIoPrintStreamLoadedClass = new JLoadedClass("java/io/PrintStream", "java/io/FilterOutputStream", [], [], [], []);
	var javaIoPrintStreamJclass = new JClass(javaIoPrintStreamLoadedClass);
	javaIoPrintStreamJclass.methods["println"] = { "jmethod": new JMethod("(I)V"), "access": ACC_PUBLIC, "code": null, "impl": 
		function(jobj, x) { 
			console.log(x);
		}
	};
	LoadedClasses.push(javaIoPrintStreamJclass);
	var systemOutStreamObj = javaIoPrintStreamJclass.createInstance();
	
	var javaLangSystemLoadedClass = new JLoadedClass("java/lang/System", "java/lang/Object", [], [], [], []);
	var javaLangSystemJclass = new JClass(javaLangSystemLoadedClass);
	javaLangSystemJclass.fields["out"] = { "jtype": new JType("Ljava/io/PrintStream;"), "access": ACC_PUBLIC|ACC_STATIC, "value": systemOutStreamObj};
	LoadedClasses.push(javaLangSystemJclass);
}

function LoadClassAndExecute(classHex) {
	// Transform class hex into actual bytes.
	JavaClassFile = hex2bytes(classHex);
	JavaClassFileIdx = 0;
	
	var magic = ReadU4();
	if (magic != 0xCAFEBABE) {
		return "Not a Java Class file!";	
	}
	
	var minor_version = ReadU2();
	var major_version = ReadU2();
	var verstr = "Java class file version " + major_version + "." + minor_version;
	
	var constant_pool_count = ReadU2();
	ReadConstantPool(constant_pool_count);
	var access_flags = ReadU2();
	var this_class = ReadU2();
	var super_class = ReadU2();
	var interfaces_count = ReadU2();
	var interfaces = [];
	for (var i = 0; i < interfaces_count; i++) {
		interfaces.push(ReadU2());
	}
	var fields_count = ReadU2();
	ReadFields(fields_count);
	
	var methods_count = ReadU2();
	ReadMethods(methods_count);
	
	var attributes_count = ReadU2();	
	ReadAttributes(attributes_count);
	
	if (JavaClassFileIdx != JavaClassFile.length) {
		ParseErrorString = "Mismatch of parse length."
	}
	
	// Inject system crap
	InjectOutputMockObjects();
	
	// Create the class obj.
	var loadedClass = new JLoadedClass(NameForClass(this_class), NameForClass(super_class), ConstantPool, Fields, Methods, Attributes);	
	var jclass = JClassFromLoadedClass(loadedClass);
	LoadedClasses.push(jclass);
	
	// Super! Now we're done reading the file:
	
	var infostr = "Class Name " + NameForClass(this_class) + ", super class " + NameForClass(super_class) + ", methods: " + methods_count;
	

	var mainmethod = jclass.mainEntryPointMethod();
	
	if (mainmethod) {
		infostr += "\nFound public static main method entry point.";
	} else {
		infostr += "\nDid not find a public static main method entry point.";
	}
					
	RunJavaThreadWithMethod(jclass, mainmethod);
	
	return ParseErrorString ? ParseErrorString : infostr;
}

module.exports = {
	LoadClassAndExecute,
}