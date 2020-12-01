// 
// utf.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
//

function KLStringFromUTF16Array(bytes) {
	let str = "";
	for (let i = 0; i < bytes.length;) {
		let word = ((bytes[i] << 8) | bytes[i+1]) >>>0;
		if (word >= 0xDC00 && word < 0xE000) { // a low surrogate is only invalid value for this pair.
			return null;
		}
		if (word < 0xDC00 || word >= 0xE000) {
			str += String.fromCharCode(word);
			i += 2;
		} else {
			let w1 = word;
			let w2 = ((bytes[i+2] << 8) | bytes[i+3]) >>>0;
			let highbits = w1 & 0x3FF;
			let lowbits = w2 & 0x3FF;
			let chprime = ((w1 << 10) | w2) >>>0;
			let ch = chprime + 0x10000;
			str += String.fromCharCode(ch);
			i += 4;
		}
	}
	return str;
}

function KLUTF16ArrayFromString(str) {
	let bytes = [];
	for (let i = 0; i < str.length; i++) {
		let ch = str.charCodeAt(i);
		if (ch < 0xD800 || (ch >= 0xE000 && ch < 0x10000)) {
			bytes.push((ch >> 8) & 0xFF);
			bytes.push(ch & 0xFF);
		} else {
			let chprime = ch - 0x10000;
			let highbits = (chprime >> 10) & 0x3FF;
			let lowbits = chprime & 0x3FF;
			let w1 = 0xD800 + highbits;
			let w2 = 0xDC00 + lowbits;
			bytes.push((w1 >> 8) & 0xFF);
			bytes.push(w1 & 0xFF);
			bytes.push((w2 >> 8) & 0xFF);
			bytes.push(w2 & 0xFF);
		}
	}
	return bytes;
}

// This routine is by Rogue Amoeba, from this blog post:
// https://weblog.rogueamoeba.com/2017/02/27/javascript-correctly-converting-a-byte-array-to-a-utf-8-string/
function RAStringFromUTF8Array(data)
{
  const extraByteMap = [ 1, 1, 1, 1, 2, 2, 3, 0 ];
  var count = data.length;
  var str = "";
  
  for (var index = 0;index < count;)
  {
    var ch = data[index++];
    if (ch & 0x80)
    {
      var extra = extraByteMap[(ch >> 3) & 0x07];
      if (!(ch & 0x40) || !extra || ((index + extra) > count))
        return null;
      
      ch = ch & (0x3F >> extra);
      for (;extra > 0;extra -= 1)
      {
        var chx = data[index++];
        if ((chx & 0xC0) != 0x80)
          return null;
        
        ch = (ch << 6) | (chx & 0x3F);
      }
    }
    
    str += String.fromCharCode(ch);
  }
  
  return str;
}