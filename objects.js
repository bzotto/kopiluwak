function JObj(jclass) {
	this.jclass = jclass;
	this.fieldVals = {};			// keyed by name: value
}

function JClass(loadedClass) {
	this.loadedClass = loadedClass;
	this.className = loadedClass.className;
	this.superclassName = loadedClass.superclassName;
	
	this.fields = {};			// keyed by name, { jtype: JType, access: access }
	this.methods = {};			// keyed by name, { jmethod: JMethod, access: access, impl:  function }
	
	// static data
	this.fieldVals = {};			// keyed by name: value
	this.isInitialized = false;
	
	
	this.createInstance = function() {
		var jobj = new JObj(this);
		
		// Create the instance fields and methods from the non-static entries in the class data.
		
		return jobj;
	}

	this.mainEntryPointMethod = function() {
		var mainMethod = this.methods["main"];
		if (mainMethod) {
			var access_flags = mainMethod.access;
			if ((access_flags & ACC_PUBLIC) && (access_flags & ACC_STATIC)) {
				// Verify the method descriptor-- should be (String[])void.
				var jmethod = mainMethod.jmethod;
				if (jmethod.returnType.isVoid() && 
					jmethod.parameterTypes.length == 1 && 
					jmethod.parameterTypes[0].dimensions == 1 &&
					jmethod.parameterTypes[0].isObject() &&
					jmethod.parameterTypes[0].objectClassDescriptor == "java/lang/String") {
						// This is the entry point.
						return mainMethod;
				}
			}
		}
		return null;
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
	
	this.bootstrapMethodsAttribute = function() {
		for (var i = 0; i < this.attributes.length; i++) {
			var attr = this.attributes[i];
			var nameIndex = attr.attribute_name_index;
			var name = this.stringFromUtf8Constant(nameIndex);
			if (name == "BootstrapMethods") {
				return attr;
			}
		}
		return null;
	}
}




 

