// 
// stdio.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 

const KLFD_stdin = 0;
const KLFD_stdout = 1;
const KLFD_stderr = 2;

function KLBufferedLineInput() {
	this.buffer = [];
	this.ready = [];
	
	this.submitInput = function(byte) {
		if (byte == 8 && this.buffer.length > 0) {
			this.buffer.pop();
		} else {
			this.buffer.push(byte);
			if (byte == 13) {
				this.ready = this.ready.concat(this.buffer);
				this.buffer = [];
			}
		}
	}

	this.available = function() {
		return this.ready.length;
	}
	
	this.readBytes = function(len) {
		let readLen = (this.ready > len) ? len : this.ready.length;
		return this.ready.splice(0, readLen);
	}
	
	this.flush = function() {
		this.ready = this.ready.concat(this.buffer);
		this.buffer = [];
	}
}

// Not currently used.
function KLBufferedOutput(lineOutputFn) {
	
	this.lineOutputFn = lineOutputFn ? lineOutputFn : function(str) { console.log(str); }
	this.buffer = [];
	
	this.outputChars = function(charsArray) {
		for (let i = 0; i < charsArray.length; i++) {
			let ch = charsArray[i];
			if (ch == '\n') {
				this.flush();
			} else {
				this.buffer.push(ch);
			}
		}
	}
	
	this.outputString = function(str) {
		let bytes = [];
	    for (let i = 0; i < str.length; i++) {
	        bytes.push(str.charCodeAt(i));
	    }
		this.outputChars(bytes);
	}
	
	this.flush = function() {
		let jsstring = "";
		for (let i = 0; i < this.buffer.length; i++) {
			jsstring += String.fromCharCode(this.buffer[i]);
		}
		this.lineOutputFn(jsstring);
		this.buffer = [];
	}	
}

function KLDirectOutput(lineOutputFn) {
	this.lineOutputFn = lineOutputFn ? lineOutputFn : function(str) { console.log(str); }
	this.outputString = function(str) {
		this.lineOutputFn(str);
	}
	this.flush = function() {};
}

function KLIoHandleFromJavaIoFileInputStream(inputStream) {	
	let fileDescriptor = inputStream.fieldValsByClass["java.io.FileInputStream"]["fd"];
	if (fileDescriptor.isa.isNull()) {
		return null;
	}
	let handle = fileDescriptor.fieldValsByClass["java.io.FileDescriptor"]["handle"];
	if (!handle.isa.isLong()) {
		return null;
	}
	return handle.val.lowWord();
}

function KLIoHandleFromJavaIoFileOutputStream(outputStream) {
	let fileDescriptor = outputStream.fieldValsByClass["java.io.FileOutputStream"]["fd"];
	if (fileDescriptor.isa.isNull()) {
		return null;
	}
	let handle = fileDescriptor.fieldValsByClass["java.io.FileDescriptor"]["handle"];
	if (!handle.isa.isLong()) {
		return null;
	}
	return handle.val.lowWord();
}

function KLIoStdinImmediatelyAvailableBytes() {
	return KLStdin.available();
}

// 
// The three standard streams.
// 

let KLStdin = new KLBufferedLineInput();
let KLStdout = new KLDirectOutput();
let KLStderr = new KLDirectOutput(function(str) { console.log("[STDERR] " + str); });

