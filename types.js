function JType(desc) {
	if (!desc.length) {
		console.log("INTERNAL ERROR: cannot create JType with empty desc, using void");
		desc = 'V'; //???
	}
	
	// Arrays are orthogonal to the other types, so first determine how many dimensions this
	// type has. 
	this.dimensions = 0;
	var idx = 0;
	while (desc[idx] == '[') {
		this.dimensions++;
		idx++;
	} 
	
	this.desc = (' ' + desc).slice(1);
	this.descriptor = desc.substring(idx);
	this.objectClassDescriptor = null;
	if (this.descriptor[0] == 'L') {
		const ocd = this.descriptor.substring(1, this.descriptor.length-1); 
		this.objectClassDescriptor = ocd;
	}
	
	this.isVoid = function() {
		return this.descriptor == 'V';
	}
	this.isByte = function() {
		return this.descriptor == 'B';
	}
	this.isChar = function() {
		return this.descriptor == 'C';
	}
	this.isDouble = function() {
		return this.descriptor == 'D';
	}
	this.isFloat = function() {
		return this.descriptor == 'F';
	}
	this.isInt = function() {
		return this.descriptor == 'I';
	}
	this.isLong = function() {
		return this.descriptor == 'J';
	}
	this.isShort = function() {
		return this.descriptor == 'S';
	}
	this.isBoolean = function() {
		return this.descriptor == 'Z';
	}
	this.isObject = function() {
		return this.descriptor[0] == 'L';
	}
	this.isArray = function() {
		return this.dimensions > 0;
	}
	this.arrayDimensions = function() {
		return this.dimensions;
	}
}

function JMethod(desc) {
	if (desc[0] != '(') {
		console.log("INTERNAL ERROR: cannot create JMethod with non-method desc, using (void)void");
		desc = "()V";
	}
	
	this.desc = (' ' + desc).slice(1);
	this.parameterTypes = [];
	this.returnType = null;
	
	var idx = 1;
	while (desc[idx] != ')') {
		var start = idx;
		var end = start;
		while (desc[end] == '[') {
			end++;
		}
		if (desc[end] == 'L') { 
			while (desc[end] != ';') {
				end++;
			}
		}
		end += 1;
		
		var thisParamDesc = desc.substring(start, end);
		var thisParamType = new JType(thisParamDesc);
		this.parameterTypes.push(thisParamType);
		idx = end;
	}
	// everything from here to the end of the method desc is the return type.
	this.returnType = new JType(desc.substring(idx+1));
}


//
// var doubleArr = new JType("[[[D");
// var object = new JType("Ljava/lang/fooble;");
// var method = new JMethod("(I[ILHelloWorld;)D");
//
