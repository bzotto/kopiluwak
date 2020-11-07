// 
// objects.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 

function JNull() {
	this.isa = new JType(JTYPE_NULL);
}

const JOBJ_STATE_UNINITIALIZED = 0;
const JOBJ_STATE_INITIALIZING  = 1;
const JOBJ_STATE_INITIALIZED   = 2;

function JObj(klclass) {
	this.isa = new JType("L" + klclass.className + ";");
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
}

function JArray(type, count) {
	this.isa = new JType("[" + type.descriptorString());
	this.class = null;
	this.atype = 0;
	this.monitor = 0;
	this.count = count;
	this.elements = [];
	for (let i = 0; i < count; i++) {
		this.elements[i] = null;
	}
}

function JByte(val) {
	this.isa = new JType(JTYPE_BYTE);
	this.val = (val != undefined) ? val : 0; 
}

function JShort(val) {
	this.isa = new JType(JTYPE_SHORT);
	this.val = (val != undefined) ? val : 0; 
}

function JInt(val) {
	this.isa = new JType(JTYPE_INT);
	this.val = (val != undefined) ? val : 0; 
}

function JLong(val) {
	this.isa = new JType(JTYPE_LONG);
	this.val = (val != undefined) ? val : 0n;
}

function JChar(val) {
	this.isa = new JType(JTYPE_CHAR);
	this.val = (val != undefined) ? val : 0; 
}

function JFloat(val) {
	this.isa = new JType(JTYPE_FlOAT);
	this.val = (val != undefined) ? val : +0.0;
}

function JDouble(val) {
	this.isa = new JType(JTYPE_DOUBLE);
	this.val = (val != undefined) ? val : +0.0;
}

function JBoolean(val) {
	this.isa = new JType(JTYPE_BOOLEAN);
	this.val = (val != undefined) ? val : false;
}

function JReturnAddr(val) {
	this.isa = new JType(JTYPE_RETURNADDR);
	this.val = (val != undefined) ? val : 0; 
}

function DefaultValueForType(jtype) {
	// Default for reference types is null.
	if (jtype.isReferenceType()) {
		return new JNull();
	}
	if (jtype.isByte()) {
		return new JByte();
	} else if (jtype.isChar()) {
		return new JChar();
	} else if (jtype.isShort()) {
		return new JShort();
	} else if (jtype.isInt()) {
		return new JInt();
	} else if (jtype.isLong()) {
		return new JLong();
	} else if (jtype.isFloat()) {
		return new JFloat();
	} else if (jtype.isDouble()) {
		return new JDouble();
	} else if (jtype.isBoolean()) {
		return new JBoolean();
	} 
	
	alert("assert: DefaultValueForType can't work with JType: " + jtype.descriptorString());
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
	
	this.fields = {};			// keyed by name
	this.vtable = {};			// keyed by identifer
	
	// static data
	this.fieldValsByClass = {};	// keyed by classname:{name:value}
	this.isInitialized = false;
	
	// Keep the constant pool and attributes around. We'll need them for runtime lookups.
	this.constantPool = loadedClass.constantPool;
	this.attributes = loadedClass.attributes;
		
	this.typeOfInstances = new JType("L" + this.className + ";");
		
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
			"descriptor": new KLMethodDescriptor(desc), 
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
		
		this.fields[name] = { "type": new JType(desc), "access": access_flags };
	}
	
	// Setup the default values of all the fields on this instance by walking up the class chain and inserting
	// default objects for each field.
	let currentClass = this;
	while (currentClass) {
		for (let fieldName in currentClass.fields) {
			let fieldType = currentClass.fields[fieldName].type;
			let fieldVal = DefaultValueForType(fieldType);
			this.fieldValsByClass[currentClass.className][fieldName] = fieldVal;
		}
		currentClass = currentClass.superclass;
	}
}
