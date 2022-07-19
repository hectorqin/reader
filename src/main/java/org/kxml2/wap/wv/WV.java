package org.kxml2.wap.wv;

import java.io.IOException;

import org.kxml2.wap.*;

/*

 * WV.java

 *

 * Created on 25 September 2003, 10:40

 */





   /** 
	 *    Wireless Village CSP 1.1 ("OMA-WV-CSP-V1_1-20021001-A.pdf")
	 *    Wireless Village CSP 1.2 ("OMA-IMPS-WV-CSP_WBXML-v1_2-20030221-C.PDF")
	 *    There are some bugs in the 1.2 spec but this is Ok. 1.2 is candidate  
 *

 * @author  Bogdan Onoiu

 */

public abstract class WV {

    

    
    
	public static WbxmlParser createParser () throws IOException {
		
		WbxmlParser parser = new WbxmlParser();

		parser.setTagTable (0, WV.tagTablePage0);
		parser.setTagTable (1, WV.tagTablePage1);
		parser.setTagTable (2, WV.tagTablePage2);
		parser.setTagTable (3, WV.tagTablePage3);
		parser.setTagTable (4, WV.tagTablePage4);
		parser.setTagTable (5, WV.tagTablePage5);
		parser.setTagTable (6, WV.tagTablePage6);
		parser.setTagTable (7, WV.tagTablePage7);
		parser.setTagTable (8, WV.tagTablePage8);
		parser.setTagTable (9, WV.tagTablePage9);
		parser.setTagTable (10, WV.tagTablePageA);

		parser.setAttrStartTable (0, WV.attrStartTable);
        
		parser.setAttrValueTable (0, WV.attrValueTable);

		return parser;
	}
    
   
    
    public static final String [] tagTablePage0 = {
        /* Common ... continue on Page 0x09 */
        "Acceptance",     //0x00, 0x05
        "AddList",        //0x00, 0x06
        "AddNickList",    //0x00, 0x07
        "SName",          //0x00, 0x08
        "WV-CSP-Message", //0x00, 0x09
        "ClientID",       //0x00, 0x0A
        "Code",           //0x00, 0x0B
        "ContactList",    //0x00, 0x0C
        "ContentData",    //0x00, 0x0D
        "ContentEncoding",//0x00, 0x0E
        "ContentSize",    //0x00, 0x0F
        "ContentType",    //0x00, 0x10
        "DateTime",       //0x00, 0x11
        "Description",    //0x00, 0x12
        "DetailedResult", //0x00, 0x13
        "EntityList",     //0x00, 0x14
        "Group",          //0x00, 0x15
        "GroupID",        //0x00, 0x16
        "GroupList",      //0x00, 0x17
        "InUse",          //0x00, 0x18
        "Logo",           //0x00, 0x19
        "MessageCount",   //0x00, 0x1A
        "MessageID",      //0x00, 0x1B
        "MessageURI",     //0x00, 0x1C
        "MSISDN",         //0x00, 0x1D
        "Name",           //0x00, 0x1E
        "NickList",       //0x00, 0x1F
        "NickName",       //0x00, 0x20
        "Poll",           //0x00, 0x21
        "Presence",       //0x00, 0x22
        "PresenceSubList",//0x00, 0x23
        "PresenceValue",  //0x00, 0x24
        "Property",       //0x00, 0x25
        "Qualifier",      //0x00, 0x26
        "Recipient",      //0x00, 0x27
        "RemoveList",     //0x00, 0x28
        "RemoveNickList", //0x00, 0x29
        "Result",         //0x00, 0x2A
        "ScreenName",     //0x00, 0x2B
        "Sender",         //0x00, 0x2C
        "Session",        //0x00, 0x2D
        "SessionDescriptor",//0x00, 0x2E
        "SessionID",      //0x00, 0x2F
        "SessionType",    //0x00, 0x30
        "Status",         //0x00, 0x31
        "Transaction",    //0x00, 0x32
        "TransactionContent",//0x00, 0x33
        "TransactionDescriptor",//0x00, 0x34
        "TransactionID",  //0x00, 0x35
        "TransactionMode",//0x00, 0x36
        "URL",            //0x00, 0x37
        "URLList",        //0x00, 0x38
        "User",           //0x00, 0x39
        "UserID",         //0x00, 0x3A
        "UserList",       //0x00, 0x3B
        "Validity",       //0x00, 0x3C
        "Value",          //0x00, 0x3D
    };
    
    public static final String [] tagTablePage1 = {
        /* Access ... continue on Page 0x0A */
        "AllFunctions",             //  0x01, 0x05
        "AllFunctionsRequest",      //  0x01, 0x06
        "CancelInvite-Request",     //  0x01, 0x07
        "CancelInviteUser-Request", //  0x01, 0x08
        "Capability",               //  0x01, 0x09
        "CapabilityList",           //  0x01, 0x0A
        "CapabilityRequest",        //  0x01, 0x0B
        "ClientCapability-Request", //  0x01, 0x0C
        "ClientCapability-Response",//  0x01, 0x0D
        "DigestBytes",          //  0x01, 0x0E
        "DigestSchema",         //  0x01, 0x0F
        "Disconnect",           //  0x01, 0x10
        "Functions",            //  0x01, 0x11
        "GetSPInfo-Request",    //  0x01, 0x12
        "GetSPInfo-Response",   //  0x01, 0x13
        "InviteID",             //  0x01, 0x14
        "InviteNote",           //  0x01, 0x15
        "Invite-Request",       //  0x01, 0x16
        "Invite-Response",      //  0x01, 0x17
        "InviteType",           //  0x01, 0x18
        "InviteUser-Request",   //  0x01, 0x19
        "InviteUser-Response",  //  0x01, 0x1A
        "KeepAlive-Request",    //  0x01, 0x1B
        "KeepAliveTime",        //  0x01, 0x1C
        "Login-Request",        //  0x01, 0x1D
        "Login-Response",       //  0x01, 0x1E
        "Logout-Request",       //  0x01, 0x1F
        "Nonce",                //  0x01, 0x20
        "Password",             //  0x01, 0x21
        "Polling-Request",      //  0x01, 0x22
        "ResponseNote",         //  0x01, 0x23
        "SearchElement",        //  0x01, 0x24
        "SearchFindings",       //  0x01, 0x25
        "SearchID",             //  0x01, 0x26
        "SearchIndex",          //  0x01, 0x27
        "SearchLimit",          //  0x01, 0x28
        "KeepAlive-Response",   //  0x01, 0x29
        "SearchPairList",       //  0x01, 0x2A
        "Search-Request",       //  0x01, 0x2B
        "Search-Response",      //  0x01, 0x2C
        "SearchResult",         //  0x01, 0x2D
        "Service-Request",      //  0x01, 0x2E
        "Service-Response",     //  0x01, 0x2F
        "SessionCookie",        //  0x01, 0x30
        "StopSearch-Request",   //  0x01, 0x31
        "TimeToLive",           //  0x01, 0x32
        "SearchString",         //  0x01, 0x33
        "CompletionFlag",       //  0x01, 0x34
        null,                   //  0x01, 0x35
        "ReceiveList",          //  0x01, 0x36 /* WV 1.2 */
        "VerifyID-Request",     //  0x01, 0x37 /* WV 1.2 */
        "Extended-Request",     //  0x01, 0x38 /* WV 1.2 */
        "Extended-Response",    //  0x01, 0x39 /* WV 1.2 */
        "AgreedCapabilityList", //  0x01, 0x3A /* WV 1.2 */
        "Extended-Data",        //  0x01, 0x3B /* WV 1.2 */
        "OtherServer",          //  0x01, 0x3C /* WV 1.2 */
        "PresenceAttributeNSName",//0x01, 0x3D /* WV 1.2 */
        "SessionNSName",        //  0x01, 0x3E /* WV 1.2 */
        "TransactionNSName",    //  0x01, 0x3F /* WV 1.2 */
    };
    
    public static final String [] tagTablePage2 = {
        /* Service ... continue on Page 0x08 */
        "ADDGM",        //  0x02, 0x05
        "AttListFunc",  //  0x02, 0x06
        "BLENT",        //  0x02, 0x07
        "CAAUT",        //  0x02, 0x08
        "CAINV",        //  0x02, 0x09
        "CALI",         //  0x02, 0x0A
        "CCLI",         //  0x02, 0x0B
        "ContListFunc", //  0x02, 0x0C
        "CREAG",        //  0x02, 0x0D
        "DALI",         //  0x02, 0x0E
        "DCLI",         //  0x02, 0x0F
        "DELGR",        //  0x02, 0x10
        "FundamentalFeat",//0x02, 0x11
        "FWMSG",        //  0x02, 0x12
        "GALS",         //  0x02, 0x13
        "GCLI",         //  0x02, 0x14
        "GETGM",        //  0x02, 0x15
        "GETGP",        //  0x02, 0x16
        "GETLM",        //  0x02, 0x17
        "GETM",         //  0x02, 0x18
        "GETPR",        //  0x02, 0x19
        "GETSPI",       //  0x02, 0x1A
        "GETWL",        //  0x02, 0x1B
        "GLBLU",        //  0x02, 0x1C
        "GRCHN",        //  0x02, 0x1D
        "GroupAuthFunc",//  0x02, 0x1E
        "GroupFeat",    //  0x02, 0x1F
        "GroupMgmtFunc",//  0x02, 0x20
        "GroupUseFunc", //  0x02, 0x21
        "IMAuthFunc",   //  0x02, 0x22
        "IMFeat",       //  0x02, 0x23
        "IMReceiveFunc",//  0x02, 0x24
        "IMSendFunc",   //  0x02, 0x25
        "INVIT",        //  0x02, 0x26
        "InviteFunc",   //  0x02, 0x27
        "MBRAC",        //  0x02, 0x28
        "MCLS",         //  0x02, 0x29
        "MDELIV",       //  0x02, 0x2A
        "NEWM",         //  0x02, 0x2B
        "NOTIF",        //  0x02, 0x2C
        "PresenceAuthFunc",//0x02, 0x2D
        "PresenceDeliverFunc",//0x02, 0x2E
        "PresenceFeat", //  0x02, 0x2F
        "REACT",        //  0x02, 0x30
        "REJCM",        //  0x02, 0x31
        "REJEC",        //  0x02, 0x32
        "RMVGM",        //  0x02, 0x33
        "SearchFunc",   //  0x02, 0x34
        "ServiceFunc",  //  0x02, 0x35
        "SETD",         //  0x02, 0x36
        "SETGP",        //  0x02, 0x37
        "SRCH",         //  0x02, 0x38
        "STSRC",        //  0x02, 0x39
        "SUBGCN",       //  0x02, 0x3A
        "UPDPR",        //  0x02, 0x3B
        "WVCSPFeat",    //  0x02, 0x3C
        "MF",           //  0x02, 0x3D /* WV 1.2 */
        "MG",           //  0x02, 0x3E /* WV 1.2 */
        "MM"            //  0x02, 0x3F /* WV 1.2 */
    };
    
    public static final String [] tagTablePage3 = {
        /* Client Capability */
        "AcceptedCharset",          //  0x03, 0x05
        "AcceptedContentLength",    //  0x03, 0x06
        "AcceptedContentType",      //  0x03, 0x07
        "AcceptedTransferEncoding", //  0x03, 0x08
        "AnyContent",               //  0x03, 0x09
        "DefaultLanguage",          //  0x03, 0x0A
        "InitialDeliveryMethod",    //  0x03, 0x0B
        "MultiTrans",               //  0x03, 0x0C
        "ParserSize",               //  0x03, 0x0D
        "ServerPollMin",            //  0x03, 0x0E
        "SupportedBearer",          //  0x03, 0x0F
        "SupportedCIRMethod",       //  0x03, 0x10
        "TCPAddress",               //  0x03, 0x11
        "TCPPort",                  //  0x03, 0x12
        "UDPPort"                  //  0x03, 0x13
    };
    
    public static final String [] tagTablePage4 = {
        /* Presence Primitive */
        "CancelAuth-Request",           //  0x04, 0x05
        "ContactListProperties",        //  0x04, 0x06
        "CreateAttributeList-Request",  //  0x04, 0x07
        "CreateList-Request",           //  0x04, 0x08
        "DefaultAttributeList",         //  0x04, 0x09
        "DefaultContactList",           //  0x04, 0x0A
        "DefaultList",                  //  0x04, 0x0B
        "DeleteAttributeList-Request",  //  0x04, 0x0C
        "DeleteList-Request",           //  0x04, 0x0D
        "GetAttributeList-Request",     //  0x04, 0x0E
        "GetAttributeList-Response",    //  0x04, 0x0F
        "GetList-Request",              //  0x04, 0x10
        "GetList-Response",             //  0x04, 0x11
        "GetPresence-Request",          //  0x04, 0x12
        "GetPresence-Response",         //  0x04, 0x13
        "GetWatcherList-Request",       //  0x04, 0x14
        "GetWatcherList-Response",      //  0x04, 0x15
        "ListManage-Request",           //  0x04, 0x16
        "ListManage-Response",          //  0x04, 0x17
        "UnsubscribePresence-Request",  //  0x04, 0x18
        "PresenceAuth-Request",         //  0x04, 0x19
        "PresenceAuth-User",            //  0x04, 0x1A
        "PresenceNotification-Request", //  0x04, 0x1B
        "UpdatePresence-Request",       //  0x04, 0x1C
        "SubscribePresence-Request",    //  0x04, 0x1D
        "Auto-Subscribe",               //  0x04, 0x1E /* WV 1.2 */
        "GetReactiveAuthStatus-Request",//  0x04, 0x1F /* WV 1.2 */
        "GetReactiveAuthStatus-Response",// 0x04, 0x20 /* WV 1.2 */
    };
    
    public static final String [] tagTablePage5 = {
        /* Presence Attribute */
        "Accuracy",         //  0x05, 0x05
        "Address",          //  0x05, 0x06
        "AddrPref",         //  0x05, 0x07
        "Alias",            //  0x05, 0x08
        "Altitude",         //  0x05, 0x09
        "Building",         //  0x05, 0x0A
        "Caddr",            //  0x05, 0x0B
        "City",             //  0x05, 0x0C
        "ClientInfo",       //  0x05, 0x0D
        "ClientProducer",   //  0x05, 0x0E
        "ClientType",       //  0x05, 0x0F
        "ClientVersion",    //  0x05, 0x10
        "CommC",            //  0x05, 0x11
        "CommCap",          //  0x05, 0x12
        "ContactInfo",      //  0x05, 0x13
        "ContainedvCard",   //  0x05, 0x14
        "Country",          //  0x05, 0x15
        "Crossing1",        //  0x05, 0x16
        "Crossing2",        //  0x05, 0x17
        "DevManufacturer",  //  0x05, 0x18
        "DirectContent",    //  0x05, 0x19
        "FreeTextLocation", //  0x05, 0x1A
        "GeoLocation",      //  0x05, 0x1B
        "Language",         //  0x05, 0x1C
        "Latitude",         //  0x05, 0x1D
        "Longitude",        //  0x05, 0x1E
        "Model",            //  0x05, 0x1F
        "NamedArea",        //  0x05, 0x20
        "OnlineStatus",     //  0x05, 0x21
        "PLMN",             //  0x05, 0x22
        "PrefC",            //  0x05, 0x23
        "PreferredContacts",//  0x05, 0x24
        "PreferredLanguage",//  0x05, 0x25
        "PreferredContent", //  0x05, 0x26
        "PreferredvCard",   //  0x05, 0x27
        "Registration",     //  0x05, 0x28
        "StatusContent",    //  0x05, 0x29
        "StatusMood",       //  0x05, 0x2A
        "StatusText",       //  0x05, 0x2B
        "Street",           //  0x05, 0x2C
        "TimeZone",         //  0x05, 0x2D
        "UserAvailability", //  0x05, 0x2E
        "Cap",              //  0x05, 0x2F
        "Cname",            //  0x05, 0x30
        "Contact",          //  0x05, 0x31
        "Cpriority",        //  0x05, 0x32
        "Cstatus",          //  0x05, 0x33
        "Note",             //  0x05, 0x34 /* WV 1.2 */
        "Zone",             //  0x05, 0x35
        null,
        "Inf_link",         //  0x05, 0x37 /* WV 1.2 */
        "InfoLink",         //  0x05, 0x38 /* WV 1.2 */
        "Link",             //  0x05, 0x39 /* WV 1.2 */
        "Text",             //  0x05, 0x3A /* WV 1.2 */
    };
    
    public static final String [] tagTablePage6 = {
        /* Messaging */
        "BlockList",                //  0x06, 0x05
//      "BlockUser-Request",        //  0x06, 0x06  //This is a bug in the spec
        "BlockEntity-Request",        //  0x06, 0x06  
        "DeliveryMethod",           //  0x06, 0x07
        "DeliveryReport",           //  0x06, 0x08
        "DeliveryReport-Request",   //  0x06, 0x09
        "ForwardMessage-Request",   //  0x06, 0x0A
        "GetBlockedList-Request",   //  0x06, 0x0B
        "GetBlockedList-Response",  //  0x06, 0x0C
        "GetMessageList-Request",   //  0x06, 0x0D
        "GetMessageList-Response",  //  0x06, 0x0E
        "GetMessage-Request",       //  0x06, 0x0F
        "GetMessage-Response",      //  0x06, 0x10
        "GrantList",                //  0x06, 0x11
        "MessageDelivered",         //  0x06, 0x12
        "MessageInfo",              //  0x06, 0x13
        "MessageNotification",      //  0x06, 0x14
        "NewMessage",               //  0x06, 0x15
        "RejectMessage-Request",    //  0x06, 0x16
        "SendMessage-Request",      //  0x06, 0x17
        "SendMessage-Response",     //  0x06, 0x18
        "SetDeliveryMethod-Request",//  0x06, 0x19
        "DeliveryTime",             //  0x06, 0x1A
    };
    
    public static final String [] tagTablePage7 = {
        /* Group */
        "AddGroupMembers-Request",  //  0x07, 0x05
        "Admin",                    //  0x07, 0x06
        "CreateGroup-Request",      //  0x07, 0x07
        "DeleteGroup-Request",      //  0x07, 0x08
        "GetGroupMembers-Request",  //  0x07, 0x09
        "GetGroupMembers-Response", //  0x07, 0x0A
        "GetGroupProps-Request",    //  0x07, 0x0B
        "GetGroupProps-Response",   //  0x07, 0x0C
        "GroupChangeNotice",        //  0x07, 0x0D
        "GroupProperties",          //  0x07, 0x0E
        "Joined",                   //  0x07, 0x0F
        "JoinedRequest",            //  0x07, 0x10
        "JoinGroup-Request",        //  0x07, 0x11
        "JoinGroup-Response",       //  0x07, 0x12
        "LeaveGroup-Request",       //  0x07, 0x13
        "LeaveGroup-Response",      //  0x07, 0x14
        "Left",                     //  0x07, 0x15
        "MemberAccess-Request",     //  0x07, 0x16
        "Mod",                      //  0x07, 0x17
        "OwnProperties",            //  0x07, 0x18
        "RejectList-Request",       //  0x07, 0x19
        "RejectList-Response",      //  0x07, 0x1A
        "RemoveGroupMembers-Request",// 0x07, 0x1B
        "SetGroupProps-Request",    //  0x07, 0x1C
        "SubscribeGroupNotice-Request", //  0x07, 0x1D
        "SubscribeGroupNotice-Response",//  0x07, 0x1E
        "Users",                    //  0x07, 0x1F
        "WelcomeNote",              //  0x07, 0x20
        "JoinGroup",                //  0x07, 0x21
        "SubscribeNotification",    //  0x07, 0x22
        "SubscribeType",            //  0x07, 0x23
        "GetJoinedUsers-Request",   //  0x07, 0x24 /* WV 1.2 */
        "GetJoinedUsers-Response",  //  0x07, 0x25 /* WV 1.2 */
        "AdminMapList",             //  0x07, 0x26 /* WV 1.2 */
        "AdminMapping",             //  0x07, 0x27 /* WV 1.2 */
        "Mapping",                  //  0x07, 0x28 /* WV 1.2 */
        "ModMapping",               //  0x07, 0x29 /* WV 1.2 */
        "UserMapList",              //  0x07, 0x2A /* WV 1.2 */
        "UserMapping",              //  0x07, 0x2B /* WV 1.2 */
    };
    
    public static final String [] tagTablePage8 = {
        /* Service ... continued */
        "MP",                       //  0x08, 0x05 /* WV 1.2 */
        "GETAUT",                   //  0x08, 0x06 /* WV 1.2 */
        "GETJU",                    //  0x08, 0x07 /* WV 1.2 */
        "VRID",                     //  0x08, 0x08 /* WV 1.2 */
        "VerifyIDFunc",             //  0x08, 0x09 /* WV 1.2 */
    };
    
    public static final String [] tagTablePage9 = {
        /* Common ... continued */
        "CIR",                      //  0x09, 0x05 /* WV 1.2 */
        "Domain",                   //  0x09, 0x06 /* WV 1.2 */
        "ExtBlock",                 //  0x09, 0x07 /* WV 1.2 */
        "HistoryPeriod",            //  0x09, 0x08 /* WV 1.2 */
        "IDList",                   //  0x09, 0x09 /* WV 1.2 */
        "MaxWatcherList",           //  0x09, 0x0A /* WV 1.2 */
        "ReactiveAuthState",        //  0x09, 0x0B /* WV 1.2 */
        "ReactiveAuthStatus",       //  0x09, 0x0C /* WV 1.2 */
        "ReactiveAuthStatusList",   //  0x09, 0x0D /* WV 1.2 */
        "Watcher",                  //  0x09, 0x0E /* WV 1.2 */
        "WatcherStatus"             //  0x09, 0x0F /* WV 1.2 */
    };
    
    public static final String [] tagTablePageA = {
        /* Access ... continued */
        "WV-CSP-NSDiscovery-Request",  //0x0A, 0x05 /* WV 1.2 */
        "WV-CSP-NSDiscovery-Response", //0x0A, 0x06 /* WV 1.2 */
        "VersionList"                  //0x0A, 0x07 /* WV 1.2 */
    };
    
    public static final String [] attrStartTable = {
        "xmlns=http://www.wireless-village.org/CSP",//  0x00, 0x05
        "xmlns=http://www.wireless-village.org/PA", //  0x00, 0x06
        "xmlns=http://www.wireless-village.org/TRC",//  0x00, 0x07
        "xmlns=http://www.openmobilealliance.org/DTD/WV-CSP",   //  0x00, 0x08
        "xmlns=http://www.openmobilealliance.org/DTD/WV-PA",    //  0x00, 0x09
        "xmlns=http://www.openmobilealliance.org/DTD/WV-TRC",   //  0x00, 0x0A
    };
    
    public static final String [] attrValueTable = {
      
        "AccessType",                           // 0x00 /* Common value token */
        "ActiveUsers",                          // 0x01 /* Common value token */
        "Admin",                                // 0x02 /* Common value token */
        "application/",                         // 0x03 /* Common value token */
        "application/vnd.wap.mms-message",      // 0x04 /* Common value token */
        "application/x-sms",                    // 0x05 /* Common value token */
        "AutoJoin",                             // 0x06 /* Common value token */
        "BASE64",                               // 0x07 /* Common value token */
        "Closed",                               // 0x08 /* Common value token */
        "Default",                              // 0x09 /* Common value token */
        "DisplayName",                          // 0x0a /* Common value token */
        "F",                                    // 0x0b /* Common value token */
        "G",                                    // 0x0c /* Common value token */
        "GR",                                   // 0x0d /* Common value token */
        "http://",                              // 0x0e /* Common value token */
        "https://",                             // 0x0f /* Common value token */
        "image/",                               // 0x10 /* Common value token */
        "Inband",                               // 0x11 /* Common value token */
        "IM",                                   // 0x12 /* Common value token */
        "MaxActiveUsers",                       // 0x13 /* Common value token */
        "Mod",                                  // 0x14 /* Common value token */
        "Name",                                 // 0x15 /* Common value token */
        "None",                                 // 0x16 /* Common value token */
        "N",                                    // 0x17 /* Common value token */
        "Open",                                 // 0x18 /* Common value token */
        "Outband",                              // 0x19 /* Common value token */
        "PR",                                   // 0x1a /* Common value token */
        "Private",                              // 0x1b /* Common value token */
        "PrivateMessaging",                     // 0x1c /* Common value token */
        "PrivilegeLevel",                       // 0x1d /* Common value token */
        "Public",                               // 0x1e /* Common value token */
        "P",                                    // 0x1f /* Common value token */
        "Request",                              // 0x20 /* Common value token */
        "Response",                             // 0x21 /* Common value token */
        "Restricted",                           // 0x22 /* Common value token */
        "ScreenName",                           // 0x23 /* Common value token */
        "Searchable",                           // 0x24 /* Common value token */
        "S",                                    // 0x25 /* Common value token */
        "SC",                                   // 0x26 /* Common value token */
        "text/",                                // 0x27 /* Common value token */
        "text/plain",                           // 0x28 /* Common value token */
        "text/x-vCalendar",                     // 0x29 /* Common value token */
        "text/x-vCard",                         // 0x2a /* Common value token */
        "Topic",                                // 0x2b /* Common value token */
        "T",                                    // 0x2c /* Common value token */
        "Type",                                 // 0x2d /* Common value token */
        "U",                                    // 0x2e /* Common value token */
        "US",                                   // 0x2f /* Common value token */
        "www.wireless-village.org",             // 0x30 /* Common value token */
        "AutoDelete",                           // 0x31 /* Common value token */ /* WV 1.2 */
        "GM",                                   // 0x32 /* Common value token */ /* WV 1.2 */
        "Validity",                             // 0x33 /* Common value token */ /* WV 1.2 */
        "ShowID",                               // 0x34 /* Common value token */ /* WV 1.2 */
        "GRANTED",                              // 0x35 /* Common value token */ /* WV 1.2 */
        "PENDING",                              // 0x36 /* Common value token */ /* WV 1.2 */
        null,                                   // 0x37
        null,                                   // 0x38
        null,                                   // 0x39
        null,                                   // 0x3a
        null,                                   // 0x3b
        null,                                   // 0x3c
        "GROUP_ID",                             // 0x3d /* Access value token */
        "GROUP_NAME",                           // 0x3e /* Access value token */
        "GROUP_TOPIC",                          // 0x3f /* Access value token */
        "GROUP_USER_ID_JOINED",                 // 0x40 /* Access value token */
        "GROUP_USER_ID_OWNER",                  // 0x41 /* Access value token */
        "HTTP",                                 // 0x42 /* Access value token */
        "SMS",                                  // 0x43 /* Access value token */
        "STCP",                                 // 0x44 /* Access value token */
        "SUDP",                                 // 0x45 /* Access value token */
        "USER_ALIAS",                           // 0x46 /* Access value token */
        "USER_EMAIL_ADDRESS",                   // 0x47 /* Access value token */
        "USER_FIRST_NAME",                      // 0x48 /* Access value token */
        "USER_ID",                              // 0x49 /* Access value token */
        "USER_LAST_NAME",                       // 0x4a /* Access value token */
        "USER_MOBILE_NUMBER",                   // 0x4b /* Access value token */
        "USER_ONLINE_STATUS",                   // 0x4c /* Access value token */
        "WAPSMS",                               // 0x4d /* Access value token */
        "WAPUDP",                               // 0x4e /* Access value token */
        "WSP",                                  // 0x4f /* Access value token */
        "GROUP_USER_ID_AUTOJOIN",               // 0x50 /* Access value token */ /* WV 1.2 */
        null,                                   // 0x51
        null,                                   // 0x52
        null,                                   // 0x53
        null,                                   // 0x54
        null,                                   // 0x55
        null,                                   // 0x56
        null,                                   // 0x57
        null,                                   // 0x58
        null,                                   // 0x59
        null,                                   // 0x5a
        "ANGRY",                                // 0x5b /* Presence value token */
        "ANXIOUS",                              // 0x5c /* Presence value token */
        "ASHAMED",                              // 0x5d /* Presence value token */
        "AUDIO_CALL",                           // 0x5e /* Presence value token */
        "AVAILABLE",                            // 0x5f /* Presence value token */
        "BORED",                                // 0x60 /* Presence value token */
        "CALL",                                 // 0x61 /* Presence value token */
        "CLI",                                  // 0x62 /* Presence value token */
        "COMPUTER",                             // 0x63 /* Presence value token */
        "DISCREET",                             // 0x64 /* Presence value token */
        "EMAIL",                                // 0x65 /* Presence value token */
        "EXCITED",                              // 0x66 /* Presence value token */
        "HAPPY",                                // 0x67 /* Presence value token */
        "IM",                                   // 0x68 /* Presence value token */
        "IM_OFFLINE",                           // 0x69 /* Presence value token */
        "IM_ONLINE",                            // 0x6a /* Presence value token */
        "IN_LOVE",                              // 0x6b /* Presence value token */
        "INVINCIBLE",                           // 0x6c /* Presence value token */
        "JEALOUS",                              // 0x6d /* Presence value token */
        "MMS",                                  // 0x6e /* Presence value token */
        "MOBILE_PHONE",                         // 0x6f /* Presence value token */
        "NOT_AVAILABLE",                        // 0x70 /* Presence value token */
        "OTHER",                                // 0x71 /* Presence value token */
        "PDA",                                  // 0x72 /* Presence value token */
        "SAD",                                  // 0x73 /* Presence value token */
        "SLEEPY",                               // 0x74 /* Presence value token */
        "SMS",                                  // 0x75 /* Presence value token */
        "VIDEO_CALL",                           // 0x76 /* Presence value token */
        "VIDEO_STREAM",                         // 0x77 /* Presence value token */
    };
    
    
}