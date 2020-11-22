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
	
	if (!klclass.isOrdinaryClass() && !klclass.isInterface()) {
		debugger;
	}
	
	this.isa = klclass.typeOfInstances;
	this.class = klclass;
	this.state = JOBJ_STATE_UNINITIALIZED;
	this.fieldValsByClass = {};			// keyed by classname:{name:value}
	
	this.meta = {}; // storage for VM metadata. Useful for e.g. Java Class objects to tie back to what they reflect.
	
	// Set up the field val class buckets and their default values.
	let currentClass = klclass;
	do {
		this.fieldValsByClass[currentClass.name] = {};
		for (let fieldName in currentClass.fields) {
			let fieldAccess = currentClass.fields[fieldName].access;
			if ((fieldAccess & ACC_STATIC) == 0) {
				let fieldType = currentClass.fields[fieldName].type;
				let fieldVal = DefaultValueForType(fieldType);
				this.fieldValsByClass[currentClass.name][fieldName] = fieldVal;
			}
		}
		currentClass = currentClass.superclass;
 	} while (currentClass);
}

function JArray(klclass, count) {
	if (!klclass.isArray()) {
		debugger;
	}
	
	this.isa = klclass.typeOfInstances;
	this.class = klclass;  
	this.containsType = this.isa.arrayComponentType(); 
	this.monitor = 0;
	this.count = count;
	this.elements = [];
	
	let defaultValue = DefaultValueForType(this.containsType);
	for (let i = 0; i < count; i++) {
		this.elements[i] = defaultValue;
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
	this.val = (val != undefined) ? val : KLInt64Zero;
}

function JChar(val) {
	this.isa = new JType(JTYPE_CHAR);
	this.val = (val != undefined) ? val : 0; 
}

function JFloat(val) {
	this.isa = new JType(JTYPE_FLOAT);
	this.val = (val != undefined) ? val : +0.0;
	this.isNaN = function() { return isNaN(this.val); }
}

function JDouble(val) {
	this.isa = new JType(JTYPE_DOUBLE);
	this.val = (val != undefined) ? val : +0.0;
}

function JReturnAddr(val) {
	this.isa = new JType(JTYPE_RETURNADDR);
	this.val = (val != undefined) ? val : 0; 
}

const JBooleanFalse = new JInt(0);
const JBooleanTrue = new JInt(1);

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
		// Boolean types are encoded as int(0|1)
		return new JInt();
	} 
	
	alert("assert: DefaultValueForType can't work with JType: " + jtype.descriptorString());
	return null;
}

const KLCLASS_STATE_UNINITIALIZED = 0;
const KLCLASS_STATE_INITIALIZING  = 1;
const KLCLASS_STATE_INITIALIZED   = 2;

function KLClass(loadedOrArrayClass, superclass) {
	// superclass can also be a superinterface
	this.superclass = superclass;
	// "name" is either a class or interface name, or if this class represents an array, it is in descriptor format.
	this.name = loadedOrArrayClass.name;   
	this.superclassName = loadedOrArrayClass.superclassName;
	this.accessFlags = loadedOrArrayClass.accessFlags;
	
	this.state = KLCLASS_STATE_UNINITIALIZED;
	this.monitor = 0;
	
	this.fields = {};			// keyed by name
	this.vtable = {};			// keyed by identifer
	
	// static data
	this.fieldValsByClass = {};	// keyed by classname:{name:value}
	
	// Keep the constant pool and attributes around. We'll need them for runtime lookups.
	this.constantPool = loadedOrArrayClass.constantPool;
	this.interfaces = loadedOrArrayClass.interfaces;
	this.attributes = loadedOrArrayClass.attributes;
		
	
	this.isArray = function() { return this.name[0] == "["; }
	this.isInterface = function() { return (this.accessFlags & ACC_INTERFACE) != 0; }
	if (this.isArray()) {
		this.typeOfInstances = new JType(this.name);
	} else {
		this.typeOfInstances = new JType("L" + this.name + ";");
		if (this.isInterface()) {
			this.typeOfInstances.setIsInterface();
		}		
	}
	this.isOrdinaryClass = function() { return !this.isArray() && !this.isInterface(); }
	
	this.createInstance = function() {
		if (!this.isOrdinaryClass()) {
			debugger;
		}
		let jobj = new JObj(this);
		return jobj;			
	}
	
	this.stringFromUtf8Constant = function(index) {
		let c = this.constantPool[index];
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
	
	this.implementsInterface = function(interfaceName) {
		for (let i in this.interfaces) {
			if (this.interfaces[i] == interfaceName) {
				return true;
			}
		}
		if (this.superclass) {
			return this.superclass.implementsInterface(interfaceName);
		} else {
			return false;
		}
	}
	
	this.methodReferenceFromIndex = function(index) {
		let methodInfo = this.constantPool[index];
		let isInterface = methodInfo.tag == CONSTANT_InterfaceMethodref;
		let classConstant = this.constantPool[methodInfo.class_index];
		let className = this.classNameFromUtf8Constant(classConstant.name_index);
		let nameAndType = this.constantPool[methodInfo.name_and_type_index];
		let methodName = this.stringFromUtf8Constant(nameAndType.name_index);
		let descriptor = this.descriptorFromUtf8Constant(nameAndType.descriptor_index);
		return { "className": className, "methodName": methodName, "descriptor": descriptor, "isInterface": isInterface };
	}
	
	this.fieldReferenceFromIndex = function(index) {
		let fieldRefInfo = this.constantPool[index];
		let classConstant = this.constantPool[fieldRefInfo.class_index];
		let className = this.classNameFromUtf8Constant(classConstant.name_index);
		let nameAndType = this.constantPool[fieldRefInfo.name_and_type_index];
		let fieldName = this.stringFromUtf8Constant(nameAndType.name_index);
		let descriptor = this.descriptorFromUtf8Constant(nameAndType.descriptor_index);
		return { "className" : className, "fieldName": fieldName, "descriptor": descriptor };
	}
		
	this.attributeWithName = function(targetName) {
		for (let i = 0; i < this.attributes.length; i++) {
			let attr = this.attributes[i];
			let nameIndex = attr.attribute_name_index;
			let name = this.stringFromUtf8Constant(nameIndex);
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
	
	// Array-specific routines
	this.arrayDimensions = function() {
		if (!this.isArray()) {
			debugger;
			return 0;
		}
		return this.typeOfInstances.arrayDimensions();
	}
	
	this.arrayComponentType = function() {
		if (!this.isArray()) {
			debugger;
			return 0;
		}
		return this.typeOfInstances.arrayComponentType();
	}
	
	//
	// Support for jdk.internal.misc.Unsafe
	//
	
	this.unsafeOffsetForInstanceField = function(fieldName) {
		// NB This only searches this specific class and no superclasses. It's not obvious to me
		// whether it's supposed to. So for now it's narrow, and will blow up with an execption should
		// valid code ever try to get an offset for a field that is not here.
		let allFields = Object.keys(this.fields);
		for (let i = 0; i < allFields.length; i++) {
			let field = this.fields[allFields[i]];
			if (!AccessFlagIsSet(field.access, ACC_STATIC) && allFields[i] == fieldName) {
				return i;
			}
		}
		return -1;
	}
	
	//
	// Set up this class object.
	//
	
	// Set up the field val class buckets.
	let curclass = this;
	do {
		this.fieldValsByClass[curclass.name] = {};
		curclass = curclass.superclass;
 	} while (curclass);
	
	// Inherit the vtable from the superclass.
	this.vtable = superclass ? Object.assign({}, superclass.vtable) : {};
	
	// Walk the loaded methods in the class and patch them up.
	for (let i = 0; i < loadedOrArrayClass.methods.length; i++) {
		let method = loadedOrArrayClass.methods[i];
		let name = this.stringFromUtf8Constant(method.name_index);
		let desc = this.descriptorFromUtf8Constant(method.descriptor_index);
		let access_flags = method.access_flags;
		
		// Is there code?	
		let codeAttr = null;
		for (let j = 0; j < method.attributes.length; j++) {
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
	for (var i = 0; i < loadedOrArrayClass.fields.length; i++) {
		let field = loadedOrArrayClass.fields[i];
		let name = this.stringFromUtf8Constant(field.name_index);
		let desc = this.descriptorFromUtf8Constant(field.descriptor_index);
		let access_flags = field.access_flags;
		
		this.fields[name] = { "type": new JType(desc), "access": access_flags };
	}
	
	// Setup the default values of all the fields on this class by walking up the class chain and inserting
	// default objects for each field.
	let currentClass = this;
	while (currentClass) {
		for (let fieldName in currentClass.fields) {
			let fieldAccess = currentClass.fields[fieldName].access;
			if ((fieldAccess & ACC_STATIC) != 0) {
				let fieldType = currentClass.fields[fieldName].type;
				let fieldVal = DefaultValueForType(fieldType);
				this.fieldValsByClass[currentClass.name][fieldName] = fieldVal;
			}
		}
		currentClass = currentClass.superclass;
	}
}
