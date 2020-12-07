// 
// native.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
// 
// Requires: constants, objects, types, jvm
//

const KLLogLevelInfo = 0;
const KLLogLevelWarn = 1;
const KLLogLevelError = 2;

let KLLogOutputFn = function(msg) {
	console.log(msg);
}

function KLLog(msg, level) {
	if (level == undefined) {
		level = KLLogLevelInfo;
	}
	
	let outstr = "";
	
	switch (level) {
	case KLLogLevelInfo:
		outstr += "[INFO] ";
		break;
	case KLLogLevelWarn:
		outstr += "[WARN] ";
		break;
	case KLLogLevelError:
		outstr += "[ERR] ";
		break;
	}
	
	KLLogOutputFn(outstr + msg);
}

function KLLogInfo(msg) {
	KLLog(msg, KLLogLevelInfo);
}

function KLLogWarn(msg) {
	KLLog(msg, KLLogLevelWarn);
}

function KLLogError(msg) {
	KLLog(msg, KLLogLevelError);
}