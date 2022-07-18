/* Copyright (c) 2002,2003, Stefan Haustein, Oberhausen, Rhld., Germany
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The  above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE. */

package org.kxml2.kdom;

import java.io.*;
import java.util.*;

import org.xmlpull.v1.*;

/** 
 * In order to create an element, please use the createElement method
 * instead of invoking the constructor directly. The right place to
 * add user defined initialization code is the init method. */

public class Element extends Node {

    protected String namespace;
    protected String name;
    protected Vector attributes;
    protected Node parent;
    protected Vector prefixes;

    public Element() {
    }

    /** 
     * called when all properties are set, but before children
     * are parsed. Please do not use setParent for initialization
     * code any longer. */

    public void init() {
    }




    /** 
     * removes all children and attributes */

    public void clear() {
        attributes = null;
        children = null;
    }

    /** 
     * Forwards creation request to parent if any, otherwise
     * calls super.createElement. */

    public Element createElement(
        String namespace,
        String name) { 

        return (this.parent == null)
            ? super.createElement(namespace, name)
            : this.parent.createElement(namespace, name);
    }

    /** 
     * Returns the number of attributes of this element. */

    public int getAttributeCount() {
        return attributes == null ? 0 : attributes.size ();
    }

	public String getAttributeNamespace (int index) {
		return ((String []) attributes.elementAt (index)) [0];
	}

/*	public String getAttributePrefix (int index) {
		return ((String []) attributes.elementAt (index)) [1];
	}*/
	
	public String getAttributeName (int index) {
		return ((String []) attributes.elementAt (index)) [1];
	}
	

	public String getAttributeValue (int index) {
		return ((String []) attributes.elementAt (index)) [2];
	}
	
	
	public String getAttributeValue (String namespace, String name) {
		for (int i = 0; i < getAttributeCount (); i++) {
			if (name.equals (getAttributeName (i)) 
				&& (namespace == null || namespace.equals (getAttributeNamespace(i)))) {
				return getAttributeValue (i);
			}
		}						
		return null;			
	}

    /** 
     * Returns the root node, determined by ascending to the 
     * all parents un of the root element. */

    public Node getRoot() {

        Element current = this;
        
        while (current.parent != null) {
            if (!(current.parent instanceof Element)) return current.parent;
            current = (Element) current.parent;
        }
        
        return current;
    }

    /** 
     * returns the (local) name of the element */

    public String getName() {
        return name;
    }

    /** 
     * returns the namespace of the element */

    public String getNamespace() {
        return namespace;
    }


    /** 
     * returns the namespace for the given prefix */
    
    public String getNamespaceUri (String prefix) {
    	int cnt = getNamespaceCount ();
		for (int i = 0; i < cnt; i++) {
			if (prefix == getNamespacePrefix (i) ||
				(prefix != null && prefix.equals (getNamespacePrefix (i))))
				return getNamespaceUri (i);	
		}
		return parent instanceof Element ? ((Element) parent).getNamespaceUri (prefix) : null;
    }


	/** 
     * returns the number of declared namespaces, NOT including
	 * parent elements */

	public int getNamespaceCount () {
		return (prefixes == null ? 0 : prefixes.size ());
	}


	public String getNamespacePrefix (int i) {
		return ((String []) prefixes.elementAt (i)) [0];
	}

	public String getNamespaceUri (int i) {
		return ((String []) prefixes.elementAt (i)) [1];
	}


    /** 
     * Returns the parent node of this element */

    public Node getParent() {
        return parent;
    }

    /* 
     * Returns the parent element if available, null otherwise 

    public Element getParentElement() {
        return (parent instanceof Element)
            ? ((Element) parent)
            : null;
    }
*/

    /** 
     * Builds the child elements from the given Parser. By overwriting 
     * parse, an element can take complete control over parsing its 
     * subtree. */

    public void parse(XmlPullParser parser)
        throws IOException, XmlPullParserException {

        for (int i = parser.getNamespaceCount (parser.getDepth () - 1);
        	i < parser.getNamespaceCount (parser.getDepth ()); i++) {
        	setPrefix (parser.getNamespacePrefix (i), parser.getNamespaceUri(i));
        }
        
        
        for (int i = 0; i < parser.getAttributeCount (); i++) 
	        setAttribute (parser.getAttributeNamespace (i),
//	        			  parser.getAttributePrefix (i),
	        			  parser.getAttributeName (i),
	        			  parser.getAttributeValue (i));


        //        if (prefixMap == null) throw new RuntimeException ("!!");

        init();


		if (parser.isEmptyElementTag()) 
			parser.nextToken ();
		else {
			parser.nextToken ();
	        super.parse(parser);

        	if (getChildCount() == 0)
            	addChild(IGNORABLE_WHITESPACE, "");
		}
		
        parser.require(
            XmlPullParser.END_TAG,
            getNamespace(),
            getName());
            
        parser.nextToken ();
    }


    /** 
     * Sets the given attribute; a value of null removes the attribute */

	public void setAttribute (String namespace, String name, String value) {
		if (attributes == null) 
			attributes = new Vector ();

		if (namespace == null) 
			namespace = "";
		
        for (int i = attributes.size()-1; i >=0; i--){
            String[] attribut = (String[]) attributes.elementAt(i);
            if (attribut[0].equals(namespace) &&
				attribut[1].equals(name)){
					
				if (value == null) {
	                attributes.removeElementAt(i);
				}
				else {
					attribut[2] = value;
				}
	            return; 
			}
        }

		attributes.addElement 
			(new String [] {namespace, name, value});
	}


	/** 
     * Sets the given prefix; a namespace value of null removess the 
	 * prefix */

	public void setPrefix (String prefix, String namespace) {
		if (prefixes == null) prefixes = new Vector ();
		prefixes.addElement (new String [] {prefix, namespace});		
	}


    /** 
     * sets the name of the element */

    public void setName(String name) {
        this.name = name;
    }

    /** 
     * sets the namespace of the element. Please note: For no
     * namespace, please use Xml.NO_NAMESPACE, null is not a legal
     * value. Currently, null is converted to Xml.NO_NAMESPACE, but
     * future versions may throw an exception. */

    public void setNamespace(String namespace) {
        if (namespace == null) 
        	throw new NullPointerException ("Use \"\" for empty namespace");
        this.namespace = namespace;
    }

    /** 
     * Sets the Parent of this element. Automatically called from the
     * add method.  Please use with care, you can simply
     * create inconsitencies in the document tree structure using
     * this method!  */

    protected void setParent(Node parent) {
        this.parent = parent;
    }


    /** 
     * Writes this element and all children to the given XmlWriter. */

    public void write(XmlSerializer writer)
        throws IOException {

		if (prefixes != null) {
			for (int i = 0; i < prefixes.size (); i++) {
				writer.setPrefix (getNamespacePrefix (i), getNamespaceUri (i));
			}
		}

        writer.startTag(
            getNamespace(),
            getName());

        int len = getAttributeCount();

        for (int i = 0; i < len; i++) {
            writer.attribute(
                getAttributeNamespace(i),
                getAttributeName(i),
                getAttributeValue(i));
        }

        writeChildren(writer);

        writer.endTag(getNamespace (), getName ());
    }
}
