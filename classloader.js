// 
// classloader.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects 
//

function KLClassLoader(classFileHexStringOrBytes) {
	
	let ClassFileData;
	let ClassFileIndex;
	let ConstantPool;
	
	//
	// Utility routines
	//
	
	function readU1() {
		return ClassFileData[ClassFileIndex++];
	}

	function readU2() {
		let hi = ClassFileData[ClassFileIndex++];
		let lo = ClassFileData[ClassFileIndex++];
		return ((hi << 8) | lo) >>> 0;
	}

	function readU4() {
		let one = ClassFileData[ClassFileIndex++];
		let two = ClassFileData[ClassFileIndex++];
		let three = ClassFileData[ClassFileIndex++];
		let four = ClassFileData[ClassFileIndex++];	
		return ((one << 24 ) | (two << 16 ) |  (three << 8 ) | four) >>> 0;
	}

	function readU1Array(len) {
		let arr = [];
		for (let i = 0; i < len; i++) {
			arr.push(readU1());
		}
		return arr;
	}
	
	function skipReadBytes(len) {
		ClassFileIndex += len;
	}
	
	//
	// Helper routines.
	//

	function stringFromUtf8Constant(index) {
		let c = ConstantPool[index];
		if (!c || c.tag != CONSTANT_Utf8) {
			return null;
		}
	    return String.fromCharCode.apply(null, c.bytes);  // XXX: This is really a UTF16 conversion. Needs to be UTF8.
	}

	function readCpInfo() {
		let tag = readU1();
		let info = { "tag" : tag };
		switch (tag) {
			case CONSTANT_Class:
				{
					info["name_index"] = readU2();
					break;
				}
			case CONSTANT_Fieldref:
				{
					info["class_index"] = readU2();
					info["name_and_type_index"] = readU2();				
					break;
				}
			case CONSTANT_Methodref:
				{
					info["class_index"] = readU2();
					info["name_and_type_index"] = readU2();				
					break;
				}
			case CONSTANT_String:
				{
					info["string_index"] = readU2();
					break;
				}
				
			case CONSTANT_NameAndType:
				{
					info["name_index"] = readU2();
					info["descriptor_index"] = readU2();
					break;
				}
			case CONSTANT_Utf8:
				{
					let len = readU2();
					info["length"] = len;
					info["bytes"] = readU1Array(len);
					break;
				}
			case CONSTANT_MethodHandle:
				{
					info["reference_kind"] = readU1();
					info["reference_index"] = readU2();
					break;
				}
			case CONSTANT_InvokeDynamic:
				{
					info["bootstrap_method_attr_index"] = readU2();
					info["name_and_type_index"] = readU2();
					break;
				}
		default:
			
			return null;
		}
	
		return info;
	}	
	
	function readAttributeInfo() {
		let info = {};
		info["attribute_name_index"] = readU2();
		let attributeLength = readU4();
	
		// We should be able to look up a name here because the constant pool should already be parsed.
		let name = stringFromUtf8Constant(info["attribute_name_index"]);
		if (name == "Code") {
			info["max_stack"] = readU2();
			info["max_locals"] = readU2();
			let codeLength = readU4();
			info["code"] = readU1Array(codeLength);
			let exceptionTableLength = readU2();
			let exceptionTable = [];
			for (let i = 0; i < exceptionTableLength; i++) {
				let exception = {};
				exception["start_pc"] = readU2();
				exception["end_pc"] = readU2();
				exception["handler_pc"] = readU2();
				exception["catch_type"] = readU2();
				exceptionTable.push(exception);
			}
			info["exception_table"] = exceptionTable;
			let attributesCount = readU2();
			let codeAttributes = [];
			for (let i = 0; i < attributesCount; i++) {
				var codeAttribute = readAttributeInfo();
				codeAttributes.push(codeAttribute);
			}
			info["attributes"] = codeAttributes;
		} else if (name == "BootstrapMethods") {
			let numBootstrapMethods = readU2();
			let bootstrapMethods = [];
			for (let i = 0; i < num_bootstrap_methods; i++) {
				let bootstrapMethod = {};
				bootstrapMethod["bootstrap_method_ref"] = readU2();
				let numBootstrapArguments = readU2();
				let bootstrapArguments = [];
				for (let j = 0; j < numBootstrapArguments; j++) {
					bootstrapArguments.push(readU2());
				}
				bootstrapMethod["bootstrap_arguments"] = bootstrapArguments;
				bootstrapMethods.push(bootstrapMethod);
			}
			info["bootstrap_methods"] = bootstrapMethods;
		} else {
			info["info"] = readU1Array(attributeLength);
		}
		return info;
	}
	
	function readMethodOrFieldInfo() {
		let info = {};
		info["access_flags"] = readU2();
		info["name_index"] = readU2();
		info["descriptor_index"] = readU2();
		let attributesCount = readU2();
		let attributes = [];
		for (let i = 0; i < attributesCount; i++) {
			let attribute = readAttributeInfo();
			if (!attribute) {
				return null;
			}
			attributes.push(attribute);
		}
		info["attributes"] = attributes;
		return info;
	}
	
	
	//
	// Main entry point for class loader, accepts an array of bytes representing the contents
	// of a class file. This method does very little validation/error checking! Don't feed it junk. 
	//
	// On success, returns { loadedClass: loadedClassObj }. 
	// On failure, returns { error: errorStr }.
	this.loadFromData = function(classData) {
		
		if (!Array.isArray(classData)) {
			return { "error" : "Bad format for class file data" };
		}
		
		ClassFileData = classData;
		ClassFileIndex = 0;
		
		ConstantPool = [];
		let interfaces = [];
		let fields = [];
		let methods = [];
		let attributes = [];
		
		let magic = readU4();
		if (magic != 0xCAFEBABE) {
			return { "error": "Not a Java class file" };
		}
	
		let minorVersion = readU2();
		let majorVersion = readU2();
	
		// Constant pool entries are 1-indexed, 
		let constantPoolCount = readU2();
		for (let i = 1; i < constantPoolCount; i++) {
			let cpEntry = readCpInfo();
			if (!cpEntry) {
				return { "error": "Failed to parse constant pool" };
			} 
			ConstantPool[i] = cpEntry;
		}
	
		let accessFlags = readU2();
		let thisClass = readU2();
		let superClass = readU2();
		
		let interfacesCount = readU2();
		for (let i = 0; i < interfacesCount; i++) {
			let interfaceIndex = readU2();
			if (interfaceIndex >= constantPoolCount) {
				return { "error": "Interface index is out of bounds" };
			} 
			let interfaceCpEntry = ConstantPool[interfaceIndex];
			if (interfaceCpEntry.tag != CONSTANT_Class) {
				return { "error": "Interface index doesn't point to a class info constant" };
			}
			interfaces.push(readU2());
		}
		
		let fieldsCount = readU2();
		for (let i = 0; i < fieldsCount; i++) {
			let fieldInfo = readMethodOrFieldInfo();
			if (!fieldInfo) {
				return { "error": "Failed to parse fields" };
			}
			fields.push(fieldInfo);
		}

		let methodsCount = readU2();
		for (let i = 0; i < methodsCount; i++) {
			let methodInfo = readMethodOrFieldInfo();
			if (!methodInfo) {
				return { "error": "Failed to parse methods" };
			}
			methods.push(methodInfo);
		}
		
		let attributesCount = readU2();
		for (let i = 0; i < attributesCount; i++) {
			let attributeInfo = readAttributeInfo();
			if (!attributeInfo) {
				return { "error": "Failed to parse attributes" };
			}
			attributes.push(attributeInfo);
		}
	
		if (ClassFileIndex != ClassFileData.length) {
			return { "error": "Mismatch class file parse length" };
		}

		let className = stringFromUtf8Constant(ConstantPool[thisClass].name_index);
		let superClassName = stringFromUtf8Constant(ConstantPool[superClass].name_index);

		// XXX: we parsed interfaces and access flags but aren't yet using them here.
		
		let jloadedClass = new JLoadedClass(className, superClassName, ConstantPool, fields, methods, attributes);
		return { "loadedClass": jloadedClass };
	};
	
	this.loadFromHexString = function(hexString) {
		let trimmed = hexString.replace(/\s/g,'');
		let chars = trimmed.match(/.{1,2}/g);
		let data = chars.map(function(h) { return parseInt(h, 16) });
		return this.loadFromData(data);
	};

	
}