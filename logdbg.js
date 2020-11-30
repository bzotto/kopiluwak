// 
// native.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, jvm
//

const KLogLevelInfo = 0;
const KLogLevelWarn = 1;
const KLogLevelError = 2;

let KLLogOutputFn = function(msg) {
	console.log(msg);
}

function KLLog(msg, level) {
	if (level == undefined) {
		level = KLogLevelInfo;
	}
	
	let outstr = "";
	
	switch (level) {
	case KLogLevelInfo:
		outstr += "[INFO] ";
		break;
	case KLogLevelWarn:
		outstr += "[WARN] ";
		break;
	case KLLogLevelError:
		outstr += "[ERR] ";
		break;
	}
	
	KLLogOutputFn(outstr + msg);
}

function KLLogInfo(msg) {
	KLLog(msg, KLogLevelInfo);
}

function KLLogWarn(msg) {
	KLLog(msg, KLogLevelWarn);
}

function KLLogError(msg) {
	KLLog(msg, KLogLevelError);
}