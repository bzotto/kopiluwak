// 
// long.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
//

function KLInt64(bytes) {
	this.storage = [];
	for (let i = 0; i < 8; i++) {
		if (typeof bytes[i] == 'number' && bytes[i] >= 0 && bytes[i] < 256) {
			this.storage[i] = bytes[i];
		} else {
			this.storage[i] = 0;
		}
	}
	
	this.isZero = function() {
		for (let i = 0; i < 8; i++) {
			if (this.storage[i] != 0) {
				return false;
			}
		}
		return true;
	}
	
	this.isNegative = function() {
		return (this.storage[0] & 0x80) != 0;
	}
}

const KLInt64Zero = new KLInt64([0, 0, 0, 0, 0, 0, 0, 0]);

function KLInt64Add(int1, int2) {
	let output = [];
	let carry = 0;
	for (let i = 7; i >= 0; i--) {
		let byte1 = int1.storage[i];
		let byte2 = int2.storage[i];
		let sum = byte1 + byte2 + carry;
		carry = (sum & 0x100) != 0 ? 1 : 0;
		output[i] = sum & 0xFF;
	}
	return new KLInt64(output);
}	

function KLInt64Negated(int) {
	let output = [];
	let carry = 1; 
	for (let i = 7; i >= 0; i--) {
		let byte = int.storage[i];
		let inv = ~byte & 0xFF;
		let res = inv + carry;
		carry = (res & 0x100) != 0 ? 1 : 0;
		output[i] = res & 0xFF;
	}
	return new KLInt64(output);
}

function KLInt64Subtract(int1, int2) {
	let negative2 = KLInt64Negated(int2);
	return KLInt64Add(int1, negative2);
}