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
	
	this.lowWord = function() {
		return ((this.storage[4] << 24) | (this.storage[5] << 16) | (this.storage[6] << 8) | this.storage[7]) >>> 0;
	}
	this.highWord = function() {
		return ((this.storage[0] << 24) | (this.storage[1] << 16) | (this.storage[2] << 8) | this.storage[3]) >>> 0;
	}
}

const KLInt64Zero = new KLInt64([0, 0, 0, 0, 0, 0, 0, 0]);

function KLInt64FromNumber(num) {
	num = Math.trunc(num);
	let output = [];
	for (let i = 7; i >= 0; i--) {
		let byte = 0;
		for (let j = 0; j < 8; j++) {
			if (num > 0) {
				let bit = num & 0x1;
				byte = byte | (bit << j);
				num = Math.trunc(num / 2);
			}
		}
		output[i] = byte;
	}
	return new KLInt64(output);
}

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

function KLInt64LogicalShiftLeft(int, s) {
	if (s < 0 || s > 63) {
		return KLInt64Zero;
	}
	let offsetLower = Math.trunc(s/8);
	let offsetUpper = offsetLower + 1;
	let upperOverhang = s % 8;
	let output = [];
	for (let i = 0; i < 8; i++) {
		let inb = int.storage[i] << upperOverhang;
		let destLower = i - offsetLower;
		let destUpper = i - offsetUpper;
		if (destUpper >= 0) {
			let outb = output[destUpper];
			if (outb == undefined) { outb = 0; }
			outb = outb | ((inb >> 8) & 0xFF);
			output[destUpper] = outb;
		}
		if (destLower >= 0) {
			let outb = output[destLower];
			if (outb == undefined) { outb = 0; }
			outb = outb | (inb & 0xFF);
			output[destLower] = outb;
		}
	}
	return new KLInt64(output);
}

function KLInt64ArithmeticShiftRight(int, s) {
	return KLInt64ShiftRight(int, s, true);
}

function KLInt64ShiftRight(int, s, arithmetic) {
	if (arithmetic == undefined) { arithmetic = false; }
	if (s < 0 || s > 63) {
		return KLInt64Zero;
	}
	let shiftBytes =  Math.trunc(s/8);
	let shiftBits = s % 8
	let output = [];
	
	if (arithmetic && int.isNegative()) {
		for (let i = 0; i < shiftBytes; i++) {
			output[i] = 0xFF;
		}
		let leftoverByte = (0xFF00 >> shiftBits) & 0xFF;
		output[shiftBytes] = leftoverByte;
	}
	
	let offsetLower = shiftBytes + 1;
	let offsetUpper = offsetLower - 1;
	let lowerOverhang = shiftBits;
	
	for (let i = 0; i < 8; i++) {
		let inb = int.storage[i] << (8 - lowerOverhang); 
		let destLower = i + offsetLower;
		let destUpper = i + offsetUpper;
		if (destUpper < 8) {
			let outb = output[destUpper];
			if (outb == undefined) { outb = 0; }
			outb = outb | ((inb >> 8) & 0xFF);
			output[destUpper] = outb;
		}
		if (destLower < 8) {
			let outb = output[destLower];
			if (outb == undefined) { outb = 0; }
			outb = outb | (inb & 0xFF);
			output[destLower] = outb;
		}
	}
	return new KLInt64(output);
}

function KLInt64Multiply(int1, int2) {
	let a = int1;
	let b = int2;
	let result = KLInt64Zero;
	while (!b.isZero()) {
		if ((b.storage[7] & 0x01) > 0) {
			result = KLInt64Add(result, a);
		}
		a = KLInt64LogicalShiftLeft(a, 1);
		b = KLInt64ShiftRight(b, 1, false);
	}
	return result;
}

function KLInt64BitwiseAnd(int1, int2) {
	let output = [];
	for (let i = 0; i < 8; i++) {
		let byte = int1.storage[i] & int2.storage[i];
		output[i] = byte;
	}
	return new KLInt64(output);
}
