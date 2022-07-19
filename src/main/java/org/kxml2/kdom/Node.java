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

import java.util.*;
import java.io.*;
import org.xmlpull.v1.*;
/** A common base class for Document and Element, also used for
    storing XML fragments. */

public class Node { //implements XmlIO{

    public static final int DOCUMENT = 0;
    public static final int ELEMENT = 2;
    public static final int TEXT = 4;
    public static final int CDSECT = 5;
    public static final int ENTITY_REF = 6;
    public static final int IGNORABLE_WHITESPACE = 7;
    public static final int PROCESSING_INSTRUCTION = 8;
    public static final int COMMENT = 9;
    public static final int DOCDECL = 10;

    protected Vector children;
    protected StringBuffer types;

    /** inserts the given child object of the given type at the
    given index. */

    public void addChild(int index, int type, Object child) {

        if (child == null)
            throw new NullPointerException();

        if (children == null) {
            children = new Vector();
            types = new StringBuffer();
        }

        if (type == ELEMENT) {
            if (!(child instanceof Element))
                throw new RuntimeException("Element obj expected)");

            ((Element) child).setParent(this);
        }
        else if (!(child instanceof String))
            throw new RuntimeException("String expected");

        children.insertElementAt(child, index);
        types.insert(index, (char) type);
    }

    /** convenience method for addChild (getChildCount (), child) */

    public void addChild(int type, Object child) {
        addChild(getChildCount(), type, child);
    }

    /** Builds a default element with the given properties. Elements
    should always be created using this method instead of the
    constructor in order to enable construction of specialized
    subclasses by deriving custom Document classes. Please note:
    For no namespace, please use Xml.NO_NAMESPACE, null is not a
    legal value. Currently, null is converted to Xml.NO_NAMESPACE,
    but future versions may throw an exception. */

    public Element createElement(String namespace, String name) {

        Element e = new Element();
        e.namespace = namespace == null ? "" : namespace;
        e.name = name;
        return e;
    }

    /** Returns the child object at the given index.  For child
        elements, an Element object is returned. For all other child
        types, a String is returned. */

    public Object getChild(int index) {
        return children.elementAt(index);
    }

    /** Returns the number of child objects */

    public int getChildCount() {
        return children == null ? 0 : children.size();
    }

    /** returns the element at the given index. If the node at the
    given index is a text node, null is returned */

    public Element getElement(int index) {
        Object child = getChild(index);
        return (child instanceof Element) ? (Element) child : null;
    }

    /** Returns the element with the given namespace and name. If the
        element is not found, or more than one matching elements are
        found, an exception is thrown. */

    public Element getElement(String namespace, String name) {

        int i = indexOf(namespace, name, 0);
        int j = indexOf(namespace, name, i + 1);

        if (i == -1 || j != -1)
            throw new RuntimeException(
                "Element {"
                    + namespace
                    + "}"
                    + name
                    + (i == -1 ? " not found in " : " more than once in ")
                    + this);

        return getElement(i);
    }

    /* returns "#document-fragment". For elements, the element name is returned 
    
    public String getName() {
        return "#document-fragment";
    }
    
    /** Returns the namespace of the current element. For Node
        and Document, Xml.NO_NAMESPACE is returned. 
    
    public String getNamespace() {
        return "";
    }
    
    public int getNamespaceCount () {
    	return 0;
    }
    
    /** returns the text content if the element has text-only
    content. Throws an exception for mixed content
    
    public String getText() {
    
        StringBuffer buf = new StringBuffer();
        int len = getChildCount();
    
        for (int i = 0; i < len; i++) {
            if (isText(i))
                buf.append(getText(i));
            else if (getType(i) == ELEMENT)
                throw new RuntimeException("not text-only content!");
        }
    
        return buf.toString();
    }
    */

    /** Returns the text node with the given index or null if the node
        with the given index is not a text node. */

    public String getText(int index) {
        return (isText(index)) ? (String) getChild(index) : null;
    }

    /** Returns the type of the child at the given index. Possible 
    types are ELEMENT, TEXT, COMMENT, and PROCESSING_INSTRUCTION */

    public int getType(int index) {
        return types.charAt(index);
    }

    /** Convenience method for indexOf (getNamespace (), name,
        startIndex). 
    
    public int indexOf(String name, int startIndex) {
        return indexOf(getNamespace(), name, startIndex);
    }
    */

    /** Performs search for an element with the given namespace and
    name, starting at the given start index. A null namespace
    matches any namespace, please use Xml.NO_NAMESPACE for no
    namespace).  returns -1 if no matching element was found. */

    public int indexOf(String namespace, String name, int startIndex) {

        int len = getChildCount();

        for (int i = startIndex; i < len; i++) {

            Element child = getElement(i);

            if (child != null
                && name.equals(child.getName())
                && (namespace == null || namespace.equals(child.getNamespace())))
                return i;
        }
        return -1;
    }

    public boolean isText(int i) {
        int t = getType(i);
        return t == TEXT || t == IGNORABLE_WHITESPACE || t == CDSECT;
    }

    /** Recursively builds the child elements from the given parser
    until an end tag or end document is found. 
        The end tag is not consumed. */

    public void parse(XmlPullParser parser)
        throws IOException, XmlPullParserException {

        boolean leave = false;

        do {
            int type = parser.getEventType();
            
   //         System.out.println(parser.getPositionDescription());
            
            switch (type) {

                case XmlPullParser.START_TAG :
                    {
                        Element child =
                            createElement(
                                parser.getNamespace(),
                                parser.getName());
                        //    child.setAttributes (event.getAttributes ());
                        addChild(ELEMENT, child);

                        // order is important here since 
                        // setparent may perform some init code!

                        child.parse(parser);
                        break;
                    }

                case XmlPullParser.END_DOCUMENT :
                case XmlPullParser.END_TAG :
                    leave = true;
                    break;

                default :
                    if (parser.getText() != null)
                        addChild(
                            type == XmlPullParser.ENTITY_REF ? TEXT : type,
                            parser.getText());
                    else if (
                        type == XmlPullParser.ENTITY_REF
                            && parser.getName() != null) {
                        addChild(ENTITY_REF, parser.getName());
                    }
                    parser.nextToken();
            }
        }
        while (!leave);
    }

    /** Removes the child object at the given index */

    public void removeChild(int idx) {
        children.removeElementAt(idx);

        /***  Modification by HHS - start ***/
        //      types.deleteCharAt (index);
        /***/
        int n = types.length() - 1;

        for (int i = idx; i < n; i++)
            types.setCharAt(i, types.charAt(i + 1));

        types.setLength(n);

        /***  Modification by HHS - end   ***/
    }

    /* returns a valid XML representation of this Element including
    	attributes and children. 
    public String toString() {
        try {
            ByteArrayOutputStream bos =
                new ByteArrayOutputStream();
            XmlWriter xw =
                new XmlWriter(new OutputStreamWriter(bos));
            write(xw);
            xw.close();
            return new String(bos.toByteArray());
        }
        catch (IOException e) {
            throw new RuntimeException(e.toString());
        }
    }
    */

    /** Writes this node to the given XmlWriter. For node and document,
        this method is identical to writeChildren, except that the
        stream is flushed automatically. */

    public void write(XmlSerializer writer) throws IOException {
        writeChildren(writer);
        writer.flush();
    }

    /** Writes the children of this node to the given XmlWriter. */

    public void writeChildren(XmlSerializer writer) throws IOException {
        if (children == null)
            return;

        int len = children.size();

        for (int i = 0; i < len; i++) {
            int type = getType(i);
            Object child = children.elementAt(i);
            switch (type) {
                case ELEMENT :
                     ((Element) child).write(writer);
                    break;

                case TEXT :
                    writer.text((String) child);
                    break;

                case IGNORABLE_WHITESPACE :
                    writer.ignorableWhitespace((String) child);
                    break;

                case CDSECT :
                    writer.cdsect((String) child);
                    break;

                case COMMENT :
                    writer.comment((String) child);
                    break;

                case ENTITY_REF :
                    writer.entityRef((String) child);
                    break;

                case PROCESSING_INSTRUCTION :
                    writer.processingInstruction((String) child);
                    break;

                case DOCDECL :
                    writer.docdecl((String) child);
                    break;

                default :
                    throw new RuntimeException("Illegal type: " + type);
            }
        }
    }
}
