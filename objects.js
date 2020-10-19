function JObj(jclass) {
	this.jclass = jclass;
	this.fieldValsByClass = {};			// keyed by classname:{name:value}
	
	// Set up the field val class buckets.
	let curclass = jclass;
	do {
		this.fieldValsByClass[curclass.className] = {};
		curclass = curclass.superclass;
 	} while (curclass);
}

function JClass(loadedClass) {
	this.loadedClass = loadedClass;
	this.superclass;
	this.className = loadedClass.className;
	this.superclassName = loadedClass.superclassName;
	
	this.fields = {};			// keyed by name, { jtype: JType, access: access }
	this.vtable = {};			// keyed by identifer, { jmethod: JMethod, access: access, impl:  function }
	
	// static data
	this.fieldVals = {};			// keyed by name: value
	this.isInitialized = false;
		
	this.createInstance = function() {
		var jobj = new JObj(this);
		
		
				
		return jobj;
	}
}

function JLoadedClass(className, superclassName, constantPool, fields, methods, attributes) {
	this.className = className;
	this.superclassName = superclassName;
	this.constantPool = constantPool;
	this.fields = fields;
	this.methods = methods;
	this.attributes = attributes;
	
	this.stringFromUtf8Constant = function(index) {
		var c = this.constantPool[index];
		// XXX: should be utf8ToString, which doesn't work rn.
	    return String.fromCharCode.apply(null, c["bytes"]);
	}
	
	this.methodInfoFromIndex = function(index) {
		var methodInfo = this.constantPool[index];
		var classConstant = this.constantPool[methodInfo.class_index];
		var className = this.stringFromUtf8Constant(classConstant.name_index);
		var nameAndType = this.constantPool[methodInfo.name_and_type_index];
		var methodName = this.stringFromUtf8Constant(nameAndType.name_index);
		var descriptor = this.stringFromUtf8Constant(nameAndType.descriptor_index);
		return { "className": className, "methodName": methodName, "descriptor": descriptor };
	}
	
	this.fieldInfoFromIndex = function(index) {
		var fieldRefInfo = this.constantPool[index];
		var classConstant = this.constantPool[fieldRefInfo.class_index];
		var className = this.stringFromUtf8Constant(classConstant.name_index);
		var nameAndType = this.constantPool[fieldRefInfo.name_and_type_index];
		var fieldName = this.stringFromUtf8Constant(nameAndType.name_index);
		var descriptor = this.stringFromUtf8Constant(nameAndType.descriptor_index);
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
}




 

