package org.kxml2.wap.syncml;

import org.kxml2.wap.*;

public abstract class SyncML {
	
	
	// SyncML-Common (-//SYNCML//DTD SyncML 1.2//EN and -//SYNCML//DTD MetInf 1.2//EN) support
	
	public static WbxmlParser createParser() {
		WbxmlParser p = new WbxmlParser();
		p.setTagTable(0, TAG_TABLE_0);
		p.setTagTable(1, TAG_TABLE_1);
		return p;
	}

	public static WbxmlSerializer createSerializer() {
		WbxmlSerializer s = new WbxmlSerializer();
		s.setTagTable(0, TAG_TABLE_0);
		s.setTagTable(1, TAG_TABLE_1);
		return s;
	}
	
	
	// SyncML-Common + DMDDF (-//OMA//DTD-DM-DDF 1.2//EN) support
	
	public static WbxmlParser createDMParser() {
		WbxmlParser p = createParser();
		p.setTagTable(2, TAG_TABLE_2_DM);
		return p;
	}

	public static WbxmlSerializer createDMSerializer() {
		WbxmlSerializer s = createSerializer();
		s.setTagTable(2, TAG_TABLE_2_DM);
		return s;
	}

	// Tables
	
    public static final String [] TAG_TABLE_0 = {
    	
    	 //  -//SYNCML//DTD SyncML 1.2//EN
    	
         "Add",            // 0x05 
         "Alert",          // 0x06 
         "Archive",        // 0x07 
         "Atomic",         // 0x08 
         "Chal",           // 0x09 
         "Cmd",            // 0x0a 
         "CmdID",          // 0x0b 
         "CmdRef",         // 0x0c 
         "Copy",           // 0x0d 
         "Cred",           // 0x0e 
         "Data",           // 0x0f 
         "Delete",         // 0x10 
         "Exec",           // 0x11 
         "Final",          // 0x12 
         "Get",            // 0x13 
         "Item",           // 0x14 
         "Lang",           // 0x15 
         "LocName",        // 0x16 
         "LocURI",         // 0x17 
         "Map",            // 0x18 
         "MapItem",        // 0x19 
         "Meta",           // 0x1a 
         "MsgID",          // 0x1b 
         "MsgRef",         // 0x1c 
         "NoResp",         // 0x1d 
         "NoResults",      // 0x1e 
         "Put",            // 0x1f 
         "Replace",        // 0x20 
         "RespURI",        // 0x21 
         "Results",        // 0x22 
         "Search",         // 0x23 
         "Sequence",       // 0x24 
         "SessionID",      // 0x25 
         "SftDel",         // 0x26 
         "Source",         // 0x27 
         "SourceRef",      // 0x28 
         "Status",         // 0x29 
         "Sync",           // 0x2a 
         "SyncBody",       // 0x2b 
         "SyncHdr",        // 0x2c 
         "SyncML",         // 0x2d 
         "Target",         // 0x2e 
         "TargetRef",      // 0x2f 
         "Reserved for future use",    // 0x30 
         "VerDTD",         // 0x31 
         "VerProto",       // 0x32 
         "NumberOfChanged",// 0x33 
         "MoreData",       // 0x34 
         "Field",          // 0x35
         "Filter",         // 0x36
         "Record",         // 0x37
         "FilterType",     // 0x38
         "SourceParent",   // 0x39
         "TargetParent",   // 0x3a
         "Move",           // 0x3b
         "Correlator"      // 0x3c
    };  
    
    public static final String [] TAG_TABLE_1 = {
	   
         //  -//SYNCML//DTD MetInf 1.2//EN 
    	
         "Anchor",         // 0x05 
         "EMI",            // 0x06 
         "Format",         // 0x07 
         "FreeID",         // 0x08 
         "FreeMem",        // 0x09 
         "Last",           // 0x0a 
         "Mark",           // 0x0b 
         "MaxMsgSize",     // 0x0c 
         "Mem",            // 0x0d 
         "MetInf",         // 0x0e 
         "Next",           // 0x0f 
         "NextNonce",      // 0x10 
         "SharedMem",      // 0x11 
         "Size",           // 0x12 
         "Type",           // 0x13 
         "Version",        // 0x14 
         "MaxObjSize",     // 0x15
         "FieldLevel"      // 0x16
         
    };

    public static final String [] TAG_TABLE_2_DM = {
 	   
        //  -//OMA//DTD-DM-DDF 1.2//EN 
   	
        "AccessType",         // 0x05 
        "ACL",                // 0x06 
        "Add",                // 0x07 
        "b64",                // 0x08 
        "bin",                // 0x09 
        "bool",               // 0x0a 
        "chr",                // 0x0b 
        "CaseSense",          // 0x0c 
        "CIS",                // 0x0d 
        "Copy",               // 0x0e 
        "CS",                 // 0x0f 
        "date",               // 0x10 
        "DDFName",            // 0x11 
        "DefaultValue",       // 0x12 
        "Delete",             // 0x13 
        "Description",        // 0x14 
        "DDFFormat",          // 0x15 
        "DFProperties",       // 0x16 
        "DFTitle",            // 0x17 
        "DFType",             // 0x18 
        "Dynamic",            // 0x19 
        "Exec",               // 0x1a 
        "float",              // 0x1b 
        "Format",             // 0x1c 
        "Get",                // 0x1d 
        "int",                // 0x1e 
        "Man",                // 0x1f 
        "MgmtTree",           // 0x20 
        "MIME",               // 0x21 
        "Mod",                // 0x22 
        "Name",               // 0x23 
        "Node",               // 0x24 
        "node",               // 0x25 
        "NodeName",           // 0x26 
        "null",               // 0x27 
        "Occurence",          // 0x28 
        "One",                // 0x29 
        "OneOrMore",          // 0x2a 
        "OneOrN",             // 0x2b 
        "Path",               // 0x2c 
        "Permanent",          // 0x2d 
        "Replace",            // 0x2e 
        "RTProperties",       // 0x2f 
        "Scope",              // 0x30 
        "Size",               // 0x31 
        "time",               // 0x32 
        "Title",              // 0x33 
        "TStamp",             // 0x34 
        "Type",               // 0x35
        "Value",              // 0x36
        "VerDTD",             // 0x37
        "VerNo",              // 0x38
        "xml",                // 0x39
        "ZeroOrMore",         // 0x3a
        "ZeroOrN",            // 0x3b
        "ZeroOrOne"           // 0x3c
        
   };
    
}

