// 
// utf.js 
//
// Kopiluwak. Copyright (c) 2020 Ben Zotto
//

//
// Conversion between UTF16 and JS strings is trivial; the JS string's length and char code
// concepts are already relative to the code points, including the surrogate pairs where
// required. We just need to convert between the byte pairs and the char codes.
//

function KLStringFromUTF16Array(bytes) {
	let str = "";
	for (let i = 0; i < bytes.length; i+=2) {
		let word = ((bytes[i] << 8) | bytes[i+1]) >>>0;
		str += String.fromCharCode(word);
	}
	return str;
}

function KLUTF16ArrayFromString(str) {
	let bytes = [];
	for (let i = 0; i < str.length; i++) {
		let ch = str.charCodeAt(i);
		bytes.push((ch >> 8) & 0xFF);
		bytes.push(ch & 0xFF);
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