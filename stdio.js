// 
// stdio.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 

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

let KLStdout = new KLDirectOutput();
