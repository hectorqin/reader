package org.kxml2.wap.wml;

import org.kxml2.wap.*;


/** This class contains the wml coding tables for elements 
 *  and attributes needed by the WmlParser. 
 */


public abstract class Wml {

	/** Creates a WbxmlParser with the WML code pages set */

	public static WbxmlParser createParser() {
		WbxmlParser p = new WbxmlParser();
		p.setTagTable(0, TAG_TABLE);
		p.setAttrStartTable(0, ATTR_START_TABLE);
		p.setAttrValueTable(0, ATTR_VALUE_TABLE);
		return p;
	}

	public static WbxmlSerializer createSerializer() {
		WbxmlSerializer s = new WbxmlSerializer();
		s.setTagTable(0, TAG_TABLE);
		s.setAttrStartTable(0, ATTR_START_TABLE);
		s.setAttrValueTable(0, ATTR_VALUE_TABLE);
		return s;
	}


    public static final String [] TAG_TABLE = {

	null, // 05
	null, // 06
	null, // 07
	null, // 08
	null, // 09
	null, // 0A
	null, // 0B
	null, // 0C
	null, // 0D
	null, // 0E
	null, // 0F

	null, // 10
	null, // 11
	null, // 12
	null, // 13
	null, // 14
	null, // 15
	null, // 16
	null, // 17
	null, // 18
	null, // 19
	null, // 1A
	null, // 1B
	"a",  // 1C
	"td", // 1D
	"tr", // 1E
	"table", // 1F

	"p", // 20
	"postfield", // 21
	"anchor", // 22
	"access", // 23
	"b",  // 24
	"big", // 25
	"br", // 26
	"card", // 27
	"do", // 28
	"em", // 29
	"fieldset", // 2A
	"go", // 2B
	"head", // 2C
	"i", // 2D
	"img", // 2E
	"input", // 2F

	"meta", // 30
	"noop", // 31
	"prev", // 32
	"onevent", // 33
	"optgroup", // 34
	"option", // 35
	"refresh", // 36
	"select", // 37
	"small", // 38
	"strong", // 39
	null, // 3A
	"template", // 3B
	"timer", // 3C
	"u", // 3D
	"setvar", // 3E
	"wml", // 3F
    };

    
    public static final String [] ATTR_START_TABLE = { 
	"accept-charset", // 05
	"align=bottom", // 06
	"align=center", // 07
	"align=left", // 08
	"align=middle", // 09
	"align=right", // 0A
	"align=top", // 0B
	"alt", // 0C
	"content", // 0D
	null, // 0E
	"domain", // 0F
	
	"emptyok=false", // 10
	"emptyok=true", // 11
	"format", // 12
	"height", // 13
	"hspace", // 14
	"ivalue", // 15
	"iname", // 16
	null, // 17
	"label", // 18
	"localsrc", // 19
	"maxlength", // 1A
	"method=get", // 1B
	"method=post", // 1C
	"mode=nowrap", // 1D
	"mode=wrap", // 1E
	"multiple=false", // 1F

	"multiple=true", // 20
	"name", // 21
	"newcontext=false", // 22
	"newcontext=true", // 23
	"onpick", // 24
	"onenterbackward", // 25
	"onenterforward", // 26
	"ontimer", // 27
	"optimal=false", // 28
	"optimal=true", // 29
	"path", // 2A
	null, // 2B
	null, // 2C
	null, // 2D
	"scheme", // 2E
	"sendreferer=false", // 2F
	
	"sendreferer=true", // 30
	"size", // 31
	"src", // 32
	"ordered=true", // 33
	"ordered=false", // 34
	"tabindex", // 35
	"title", // 36
	"type", // 37
	"type=accept", // 38
	"type=delete", // 39
	"type=help", // 3A
	"type=password", // 3B
	"type=onpick", // 3C
	"type=onenterbackward", // 3D
	"type=onenterforward", // 3E
	"type=ontimer", // 3F

	null, // 40
	null, // 41
	null, // 42
	null, // 43
	null, // 44
	"type=options", // 45
	"type=prev", // 46
	"type=reset", // 47
	"type=text", // 48
	"type=vnd.", // 49
	"href", // 4A
	"href=http://", // 4B
	"href=https://", // 4C
	"value", // 4D
	"vspace", // 4E
	"width", // 4F

	"xml:lang", // 50
	null, // 51
	"align", // 52
	"columns", // 53
	"class", // 54
	"id", // 55
	"forua=false", // 56
	"forua=true", // 57
	"src=http://", // 58
	"src=https://", // 59
	"http-equiv", // 5A
	"http-equiv=Content-Type", // 5B
	"content=application/vnd.wap.wmlc;charset=", // 5C
	"http-equiv=Expires", // 5D
	null, // 5E
	null, // 5F
    };


    public static final String [] ATTR_VALUE_TABLE = {
	".com/", // 85
	".edu/", // 86
	".net/", // 87
	".org/", // 88
	"accept", // 89
	"bottom", // 8A
	"clear", // 8B
	"delete", // 8C
	"help", // 8D
	"http://", // 8E
	"http://www.", // 8F
	
	"https://", // 90
	"https://www.", // 91
	null, // 92
	"middle", // 93
	"nowrap", // 94
	"onpick", // 95
	"onenterbackward", // 96
	"onenterforward", // 97
	"ontimer", // 98
	"options", // 99
	"password", // 9A
	"reset", // 9B
	null, // 9C
	"text", // 9D
	"top", // 9E
	"unknown", // 9F
	
	"wrap", // A0
	"www.", // A1
    };
}    

