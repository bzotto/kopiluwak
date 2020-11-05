
// Reference types
const JTYPE_CLASS = 1;
const JTYPE_ARRAY = 2;
const JTYPE_INTERFACE = 3;
// Primitive types
const JTYPE_BYTE = 4
const JTYPE_SHORT = 5;
const JTYPE_INT = 6;
const JTYPE_LONG = 7;
const JTYPE_CHAR = 8;
const JTYPE_FLOAT = 9;
const JTYPE_DOUBLE = 10;
const JTYPE_BOOLEAN = 11;
const JTYPE_RETURNADDR = 12;


const JOBJ_STATE_UNINITIALIZED = 0;
const JOBJ_STATE_INITIALIZING  = 1;
const JOBJ_STATE_INITIALIZED   = 2;

function JNull() {
	this.isa = JTYPE_CLASS;
	this.isReference = true;
	this.isPrimitive = false;
}

function JObj(klclass) {
	this.class = klclass;
	this.state = JOBJ_STATE_UNINITIALIZED;
	this.fieldValsByClass = {};			// keyed by classname:{name:value}
	
	this.meta = {}; // storage for VM metadata. Useful for e.g. Java Class objects to tie back to what they reflect.
	
	// Set up the field val class buckets.
	let curclass = klclass;
	do {
		this.fieldValsByClass[curclass.className] = {};
		curclass = curclass.superclass;
 	} while (curclass);
	
	this.isa = JTYPE_CLASS;
	this.isReference = true;
	this.isPrimitive = false;
}

function JArray(classOrType, count) {
	this.class = null;
	this.atype = 0;
	this.monitor = 0;
	if (Number.isInteger(classOrType)) {
		this.atype = classOrType;
	} else {
		this.class = classOrType;
	}
	this.count = count;
	this.elements = [];
	for (let i = 0; i < count; i++) {
		this.elements[i] = null;
	}
	
	this.isa = JTYPE_ARRAY;
	this.isReference = true;
	this.isPrimitive = false;
}

function JInteger(isa, val) {
	this.val = (val != undefined) ? val : 0; // all integral values are zero, and the char 0 = '\u00000 (== 0)
	this.isa = isa;
	this.isReference = false;
	this.isPrimitive = true;
}

function JFloat(isa, val) {
	this.val = (val != undefined) ? val : +0.0;
	this.isa = isa;
	this.isReference = false;
	this.isPrimitive = true;
	
	this.isNaN = function() { return isNaN(this.val); }
}

function JBoolean(val) {
	this.val = (val != undefined) ? val : false;
	this.isa = JTYPE_BOOLEAN;
	this.isReference = false;
	this.isPrimitive = true;
}

function JReturnAddress(val) {
	this.val = (val != undefined) ? val : 0; 
	this.isa = JTYPE_RETURNADDR;
	this.isReference = false;
	this.isPrimitive = true;
}

function DefaultObjectForJType(jtype) {
	// Default for reference types is null.
	if (jtype.isObject() || jtype.isArray()) {
		return null;
	}
	if (jtype.isByte()) {
		return new JInteger(JTYPE_BYTE);
	} else if (jtype.isChar()) {
		return new JInteger(JTYPE_CHAR);
	} else if (jtype.isShort()) {
		return new JInteger(JTYPE_SHORT);
	} else if (jtype.isInt()) {
		return new JInteger(JTYPE_INT);
	} else if (jtype.isLong()) {
		return new JInteger(JTYPE_LONG);
	} else if (jtype.isFloat()) {
		return new JFloat(JTYPE_FLOAT);
	} else if (jtype.isDouble()) {
		return new JFloat(JTYPE_DOUBLE);
	} else if (jtype.isBoolean()) {
		return new JBoolean();
	} 
	
	alert("assert: DefaultObjectForJType can't work with JType: " + jtype.desc);
	return null;
}

const KLCLASS_STATE_UNINITIALIZED = 0;
const KLCLASS_STATE_INITIALIZING  = 1;
const KLCLASS_STATE_INITIALIZED   = 2;

function KLClass(loadedClass, superclass) {
	this.superclass = superclass;
	this.className = loadedClass.className;
	this.superclassName = loadedClass.superclassName;
	
	this.state = KLCLASS_STATE_UNINITIALIZED;
	this.monitor = 0;
	
	this.fields = {};			// keyed by name, { jtype: JType, access: access }
	this.vtable = {};			// keyed by identifer, { jmethod: JMethod, access: access, impl:  function }
	
	// static data
	this.fieldValsByClass = {};	// keyed by classname:{name:value}
	this.isInitialized = false;
	
	// Keep the constant pool and attributes around. We'll need them for runtime lookups.
	this.constantPool = loadedClass.constantPool;
	this.attributes = loadedClass.attributes;
		
	this.createInstance = function() {
		var jobj = new JObj(this);
		return jobj;
	}
	
	this.stringFromUtf8Constant = function(index) {
		var c = this.constantPool[index];
		// XXX: should be utf8ToString, which doesn't work rn.
	    return String.fromCharCode.apply(null, c["bytes"]);
	}
	
	this.classNameFromUtf8Constant = function(index) {
		let name = this.stringFromUtf8Constant(index);
		return name.replace(/\//g, ".");
	}
	
	this.descriptorFromUtf8Constant = function(index) {
		let name = this.stringFromUtf8Constant(index);
		return name.replace(/\//g, ".");
	}
	
	this.methodReferenceFromIndex = function(index) {
		var methodInfo = this.constantPool[index];
		var classConstant = this.constantPool[methodInfo.class_index];
		var className = this.classNameFromUtf8Constant(classConstant.name_index);
		var nameAndType = this.constantPool[methodInfo.name_and_type_index];
		var methodName = this.stringFromUtf8Constant(nameAndType.name_index);
		var descriptor = this.descriptorFromUtf8Constant(nameAndType.descriptor_index);
		return { "className": className, "methodName": methodName, "descriptor": descriptor };
	}
	
	this.fieldReferenceFromIndex = function(index) {
		var fieldRefInfo = this.constantPool[index];
		var classConstant = this.constantPool[fieldRefInfo.class_index];
		var className = this.classNameFromUtf8Constant(classConstant.name_index);
		var nameAndType = this.constantPool[fieldRefInfo.name_and_type_index];
		var fieldName = this.stringFromUtf8Constant(nameAndType.name_index);
		var descriptor = this.descriptorFromUtf8Constant(nameAndType.descriptor_index);
		return { "className" : className, "fieldName": fieldName, "descriptor": descriptor };
	}
		
	this.attributeWithName = function(targetName) {
		for (var i = 0; i < this.attributes.length; i++) {
			var attr = this.attributes[i];
			var nameIndex = attr.attribute_name_index;
			var name = this.stringFromUtf8Constant(nameIndex);
			if (name == targetName) {
				return attr;
			}
		}
		return null;
	}
	
	this.sourceFileName = function() {
		let sourceFileAttr = this.attributeWithName("SourceFile");
		if (sourceFileAttr) {
			return this.stringFromUtf8Constant(sourceFileAttr.sourcefile_index);
		}
		return null;
	}
	
	//
	// Set up this class object.
	//
	
	// Set up the field val class buckets.
	let curclass = this;
	do {
		this.fieldValsByClass[curclass.className] = {};
		curclass = curclass.superclass;
 	} while (curclass);
	
	// Inherit the vtable from the superclass.
	this.vtable = superclass ? Object.assign({}, superclass.vtable) : {};
	
	// Walk the loaded methods in the class and patch them up.
	for (let i = 0; i < loadedClass.methods.length; i++) {
		let method = loadedClass.methods[i];
		let name = this.stringFromUtf8Constant(method.name_index);
		let desc = this.descriptorFromUtf8Constant(method.descriptor_index);
		let access_flags = method.access_flags;
		
		// Is there code?	
		let codeAttr = null;
		for (var j = 0; j < method.attributes.length; j++) {
			let attr = method.attributes[j];
			let attrname = this.stringFromUtf8Constant(attr.attribute_name_index);
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
				let attrname = this.stringFromUtf8Constant(attr.attribute_name_index);
				if (attrname == "LineNumberTable") {
					lineNumberTable = attr.line_number_table;
					break;
				}
			}
		}
		
		// The implementing class is included because the vtable gets copied to subclasses upon load.
		this.vtable[methodIdentifier] = { 
			"name": name, 
			"class": this,
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
		var name = this.stringFromUtf8Constant(field.name_index);
		var desc = this.descriptorFromUtf8Constant(field.descriptor_index);
		var access_flags = field.access_flags;
		
		this.fields[name] = { "jtype": new JType(desc), "access": access_flags };
	}
	
	// Setup the default values of all the fields on this instance by walking up the class chain and inserting
	// default objects for each field.
	let currentClass = this;
	while (currentClass) {
		for (let fieldName in currentClass.fields) {
			let fieldType = currentClass.fields[fieldName].jtype;
			let fieldVal = DefaultObjectForJType(fieldType);
			this.fieldValsByClass[currentClass.className][fieldName] = fieldVal;
		}
		currentClass = currentClass.superclass;
	}
}
