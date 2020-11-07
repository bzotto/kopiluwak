// 
// types.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 

//
// JTYPE constant definitions.
//

// Reference types
const JTYPE_NULL = 0;
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

//
// Describes a valid Java-land type. Can describe a primitive or reference type, and 
// optionally has a "name" which names a class or interface, or a "subtype" (also a JType 
// instance) which describes the type contained within an array type. 
//
// Can be initialized with the numeric type for a primitive. Can be initialized with a 
// valid descriptor for primitive, array, or reference types. Void is not an actual type, so 
// the descriptor "V" is not valid here, and there is no descriptor for the returnAddress type.
//
function JType(typeOrDescriptor) {

	this.type = JTYPE_NULL; // a JTYPE_* value
	this.name = null; // the name of a class or interface   
	this.dimensions = 0; // number of dimensions of an array
	this.componentType = null; // the type contained within an array. (Another JType instance.)
	
	//
	// The only way to mutate this object is by flagging it from a class to an interface. This is
	// because there's no way to construct an interface as such, the descriptor is identical to a 
	// class descriptor. So the caller has to know, and can signal it after creating the type.
	//
	
	this.setIsInterface = function() {
		// Only allow this if currently a class type.
		if (this.type == JTYPE_CLASS) {
			this.type = JTYPE_INTERFACE;
		} 
	}
	
	//
	// Public predicates and accessors.
	//
	
	this.isNull = function() {
		return this.type == JTYPE_NULL;
	}
	this.isPrimitiveType = function() {
		return this.type >= 4 && this.type <= 12;
	}
	this.isReferenceType = function() {
		return this.type >= 0 && this.type <= 3;
	}
	this.isClass = function() {
		return this.type == JTYPE_CLASS;
	}
	this.className = function() {
		return this.name;
	}
	this.isInterface = function() {
		return this.type == JTYPE_INTERFACE;
	}
	this.interfaceName = function() {
		return this.name;
	}
	this.isArray = function() {
		return this.type == JTYPE_ARRAY;
	}
	this.arrayDimensions = function() {
		return this.dimensions;
	}
	this.arrayComponentType = function() {
		return this.componentType;
	}
	this.isIntegralType = function() {
		return this.type == JTYPE_BYTE || this.type == JTYPE_SHORT || this.type == JTYPE_INT || this.type == JTYPE_LONG;
	}
	this.isFloatingType = function() {
		return this.type == JTYPE_FLOAT || this.type == JTYPE_DOUBLE;
	}
	this.isByte = function() {
		return this.type == JTYPE_BYTE;
	}
	this.isShort = function() {
		return this.type == JTYPE_SHORT;
	}
	this.isInt = function() {
		return this.type == JTYPE_INT;
	}
	this.isLong = function() {
		return this.type == JTYPE_LONG;
	}
	this.isChar = function() {
		return this.type == JTYPE_CHAR;
	}
	this.isFloat = function() {
		return this.type == JTYPE_FLOAT;
	}
	this.isDouble = function() {
		return this.type == JTYPE_DOUBLE;
	}
	this.isBoolean = function() {
		return this.type == JTYPE_BOOLEAN;
	}
	this.isReturnAddress = function() {
		return this.type == JTYPE_RETURNADDR;
	}
	this.descriptorString = function() {
		switch (this.type) {
		case JTYPE_CLASS:
		case JTYPE_INTERFACE:
			return "L" + this.name + ";";
		case JTYPE_ARRAY:
			{
				let str = "";
				for (let i = 0; i < this.dimensions; i++) {
					str = str + "[";
				}
				return str + this.componentType.descriptorString();
			}
		case JTYPE_BYTE:
			return "B";
		case JTYPE_SHORT:
			return "S";
		case JTYPE_INT:
			return "I";
		case JTYPE_LONG:
			return "J";
		case JTYPE_CHAR:
			return "C";
		case JTYPE_FLOAT:
			return "F";
		case JTYPE_DOUBLE:
			return "D";
		case JTYPE_BOOLEAN:
			return "Z";
			
		case JTYPE_NULL:
		case JTYPE_RETURNADDR:
			// We can produce a descriptor string for all types except return address, 
			// which doesn't map to a Java language type and doesn't show up in descriptors. Null is a synthetic 
			// placeholder, not a real type, and thus is not meaningful in descriptors.
			return null;
		}
	}
	
	//
	// Construction
	//	
	
	if (typeof typeOrDescriptor == 'number') {
		let type = typeOrDescriptor;
		if (type != JTYPE_NULL && (type < 4 || type > 12)) {
			console.log("JType: can't create with numeric type " + type);
			type = JTYPE_NULL;
		}
		this.type = type;
	} else if (typeof typeOrDescriptor == 'string') {
		let fieldType = typeOrDescriptor;
		
		// See if there are array dimensions to be had.
		this.dimensions = 0;
		let idx = 0;
		while (fieldType[idx] == '[') {
			this.dimensions++;
			idx++;
		} 
		
		// If this is an array, then mark this object as an array and recusively create the component
		// type with the remainder of the string.
		if (this.dimensions > 0) {
			this.type = JTYPE_ARRAY;
			this.componentType = new JType(fieldType.substring(idx));
		} else {
			let baseOrObjectType = fieldType;
				
			if (baseOrObjectType[0] == "L") {
				// This can signal either a class or interface, the descriptor syntax does not disambiguate so the caller
				// will have to flag this as an interface after the construction if that is known.
				this.type = JTYPE_CLASS; 
				this.name = baseOrObjectType.substring(1, baseOrObjectType.length-1); 
			} else {
				let baseType = baseOrObjectType;
				if (baseType == "B") {
					this.type = JTYPE_BYTE;
				} else if (baseType == "S") {
					this.type = JTYPE_SHORT;
				} else if (baseType == "I") {
					this.type = JTYPE_INT;
				} else if (baseType == "J") {
					this.type = JTYPE_LONG;
				} else if (baseType == "C") {
					this.type = JTYPE_CHAR;
				} else if (baseType == "F") {
					this.type = JTYPE_FLOAT;
				} else if (baseType == "D") {
					this.type = JTYPE_DOUBLE;
				} else if (baseType == "Z") {
					this.type = JTYPE_BOOLEAN;
				}
			}
		}
	}
}

//
// Parses and describes a method argument and return types with instances of type objects.
// 

function KLMethodDescriptor(descriptorString) {
	
	if (descriptorString[0] != '(') {
		console.log("Cannot create KLMethodDescriptor with non-method desc " + descriptorString + ", using (void)void");
		descriptorString = "()V";
	}
	
	this.descriptor = (' ' + descriptorString).slice(1);
	this.parameterTypes = [];
	this.return = null;
	
	//
	// Accessors
	//
	
	this.descriptorString = function() {
		return this.descriptor;
	}
	this.parameterCount = function() {
		return this.parameterTypes.length;
	}
	this.parameterTypeAtIndex = function(index) {
		return this.parameterTypes[index];
	}
	this.returnsVoid = function() {
		return this.return == null;
	}
	this.returnType = function() {
		return this.return;
	}
	
	
	//
	// Construction
	//
		
	let idx = 1;
	while (descriptorString[idx] != ')') {
		let start = idx;
		let end = start;
		while (descriptorString[end] == '[') {
			end++;
		}
		if (descriptorString[end] == 'L') { 
			while (descriptorString[end] != ';') {
				end++;
			}
		}
		end += 1;
		
		let thisParamDesc = descriptorString.substring(start, end);
		let thisParamType = new JType(thisParamDesc);
		this.parameterTypes.push(thisParamType);
		idx = end;
	}
	// Everything from here to the end of the method desc is the return type.
	// Void return is specified with "V" but that's not a real type, so if that's 
	// what we see, leave the return type null.
	let returnDescriptor = descriptorString.substring(idx+1);
	if (returnDescriptor != "V") {
		this.return = new JType(returnDescriptor);
	}	
}