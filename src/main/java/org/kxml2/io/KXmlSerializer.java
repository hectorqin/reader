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
 

package org.kxml2.io;

import java.io.*;
import org.xmlpull.v1.*;

public class KXmlSerializer implements XmlSerializer {

    //    static final String UNDEFINED = ":";

    private Writer writer;

    private boolean pending;
    private int auto;
    private int depth;

    private String[] elementStack = new String[12];
    //nsp/prefix/name
    private int[] nspCounts = new int[4];
    private String[] nspStack = new String[8];
    //prefix/nsp; both empty are ""
    private boolean[] indent = new boolean[4];
    private boolean unicode;
    private String encoding;

    private final void check(boolean close) throws IOException {
        if (!pending)
            return;

        depth++;
        pending = false;

        if (indent.length <= depth) {
            boolean[] hlp = new boolean[depth + 4];
            System.arraycopy(indent, 0, hlp, 0, depth);
            indent = hlp;
        }
        indent[depth] = indent[depth - 1];

        for (int i = nspCounts[depth - 1];
            i < nspCounts[depth];
            i++) {
            writer.write(' ');
            writer.write("xmlns");
            if (!"".equals(nspStack[i * 2])) {
                writer.write(':');
                writer.write(nspStack[i * 2]);
            }
            else if ("".equals(getNamespace()) && !"".equals(nspStack[i * 2 + 1]))
                throw new IllegalStateException("Cannot set default namespace for elements in no namespace");
            writer.write("=\"");
            writeEscaped(nspStack[i * 2 + 1], '"');
            writer.write('"');
        }

        if (nspCounts.length <= depth + 1) {
            int[] hlp = new int[depth + 8];
            System.arraycopy(nspCounts, 0, hlp, 0, depth + 1);
            nspCounts = hlp;
        }

        nspCounts[depth + 1] = nspCounts[depth];
        //   nspCounts[depth + 2] = nspCounts[depth];

        writer.write(close ? " />" : ">");
    }

    private final void writeEscaped(String s, int quot)
        throws IOException {

        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
            	case '\n':
            	case '\r':
            	case '\t':
            		if(quot == -1) 
            			writer.write(c);
            		else 
            			writer.write("&#"+((int) c)+';');
            		break;
                case '&' :
                    writer.write("&amp;");
                    break;
                case '>' :
                    writer.write("&gt;");
                    break;
                case '<' :
                    writer.write("&lt;");
                    break;
                case '"' :
                case '\'' :
                    if (c == quot) {
                        writer.write(
                            c == '"' ? "&quot;" : "&apos;");
                        break;
                    }
                default :
                	//if(c < ' ')
					//	throw new IllegalArgumentException("Illegal control code:"+((int) c));

                    if (i < s.length() - 1) {
                        char cLow = s.charAt(i + 1);
                        // c is high surrogate and cLow is low surrogate
                        if (c >= 0xd800 && c <= 0xdbff && cLow >= 0xdc00 && cLow <= 0xdfff) {
                            // write surrogate pair as single code point
                            int n = ((c - 0xd800) << 10) + (cLow - 0xdc00) + 0x010000;
                            writer.write("&#" + n + ";");
                            i++; // Skip the low surrogate
                            break;
                        }
                        // Does nothing smart about orphan surrogates, just output them "as is"
                    }
                    if (c >= ' ' && c !='@' && (c < 127 || unicode)) {
                        writer.write(c);
                    } else {
                        writer.write("&#" + ((int) c) + ";");
                    }
            }
        }
    }

    /*
    	private final void writeIndent() throws IOException {
    		writer.write("\r\n");
    		for (int i = 0; i < depth; i++)
    			writer.write(' ');
    	}*/

    public void docdecl(String dd) throws IOException {
        writer.write("<!DOCTYPE");
        writer.write(dd);
        writer.write(">");
    }

    public void endDocument() throws IOException {
        while (depth > 0) {
            endTag(
                elementStack[depth * 3 - 3],
                elementStack[depth * 3 - 1]);
        }
        flush();
    }

    public void entityRef(String name) throws IOException {
        check(false);
        writer.write('&');
        writer.write(name);
        writer.write(';');
    }

    public boolean getFeature(String name) {
        //return false;
        return (
            "http://xmlpull.org/v1/doc/features.html#indent-output"
                .equals(
                name))
            ? indent[depth]
            : false;
    }

    public String getPrefix(String namespace, boolean create) {
        try {
            return getPrefix(namespace, false, create);
        }
        catch (IOException e) {
            throw new RuntimeException(e.toString());
        }
    }

    private final String getPrefix(
        String namespace,
        boolean includeDefault,
        boolean create)
        throws IOException {

        for (int i = nspCounts[depth + 1] * 2 - 2;
            i >= 0;
            i -= 2) {
            if (nspStack[i + 1].equals(namespace)
                && (includeDefault || !nspStack[i].equals(""))) {
                String cand = nspStack[i];
                for (int j = i + 2;
                    j < nspCounts[depth + 1] * 2;
                    j++) {
                    if (nspStack[j].equals(cand)) {
                        cand = null;
                        break;
                    }
                }
                if (cand != null)
                    return cand;
            }
        }

        if (!create)
            return null;

        String prefix;

        if ("".equals(namespace))
            prefix = "";
        else {
            do {
                prefix = "n" + (auto++);
                for (int i = nspCounts[depth + 1] * 2 - 2;
                    i >= 0;
                    i -= 2) {
                    if (prefix.equals(nspStack[i])) {
                        prefix = null;
                        break;
                    }
                }
            }
            while (prefix == null);
        }

		boolean p = pending;
		pending = false;
        setPrefix(prefix, namespace);
        pending = p;
        return prefix;
    }

    public Object getProperty(String name) {
        throw new RuntimeException("Unsupported property");
    }

    public void ignorableWhitespace(String s)
        throws IOException {
        text(s);
    }

    public void setFeature(String name, boolean value) {
        if ("http://xmlpull.org/v1/doc/features.html#indent-output"
            .equals(name)) {
            indent[depth] = value;
        }
        else
            throw new RuntimeException("Unsupported Feature");
    }

    public void setProperty(String name, Object value) {
        throw new RuntimeException(
            "Unsupported Property:" + value);
    }

    public void setPrefix(String prefix, String namespace)
        throws IOException {

        check(false);
        if (prefix == null)
            prefix = "";
        if (namespace == null)
            namespace = "";

        String defined = getPrefix(namespace, true, false);

        // boil out if already defined

        if (prefix.equals(defined))
            return;

        int pos = (nspCounts[depth + 1]++) << 1;

        if (nspStack.length < pos + 1) {
            String[] hlp = new String[nspStack.length + 16];
            System.arraycopy(nspStack, 0, hlp, 0, pos);
            nspStack = hlp;
        }

        nspStack[pos++] = prefix;
        nspStack[pos] = namespace;
    }

    public void setOutput(Writer writer) {
        this.writer = writer;

        // elementStack = new String[12]; //nsp/prefix/name
        //nspCounts = new int[4];
        //nspStack = new String[8]; //prefix/nsp
        //indent = new boolean[4];

        nspCounts[0] = 2;
        nspCounts[1] = 2;
        nspStack[0] = "";
        nspStack[1] = "";
        nspStack[2] = "xml";
        nspStack[3] = "http://www.w3.org/XML/1998/namespace";
        pending = false;
        auto = 0;
        depth = 0;

        unicode = false;
    }

    public void setOutput(OutputStream os, String encoding)
        throws IOException {
        if (os == null)
            throw new IllegalArgumentException();
        setOutput(
            encoding == null
                ? new OutputStreamWriter(os)
                : new OutputStreamWriter(os, encoding));
        this.encoding = encoding;
        if (encoding != null
            && encoding.toLowerCase().startsWith("utf"))
            unicode = true;
    }

    public void startDocument(
        String encoding,
        Boolean standalone)
        throws IOException {
        writer.write("<?xml version='1.0' ");

        if (encoding != null) {
            this.encoding = encoding;
            if (encoding.toLowerCase().startsWith("utf"))
                unicode = true;
        }

        if (this.encoding != null) {
            writer.write("encoding='");
            writer.write(this.encoding);
            writer.write("' ");
        }

        if (standalone != null) {
            writer.write("standalone='");
            writer.write(
                standalone.booleanValue() ? "yes" : "no");
            writer.write("' ");
        }
        writer.write("?>");
    }

    public XmlSerializer startTag(String namespace, String name)
        throws IOException {
        check(false);

        //        if (namespace == null)
        //            namespace = "";

        if (indent[depth]) {
            writer.write("\r\n");
            for (int i = 0; i < depth; i++)
                writer.write("  ");
        }

        int esp = depth * 3;

        if (elementStack.length < esp + 3) {
            String[] hlp = new String[elementStack.length + 12];
            System.arraycopy(elementStack, 0, hlp, 0, esp);
            elementStack = hlp;
        }

        String prefix =
            namespace == null
                ? ""
                : getPrefix(namespace, true, true);

        if ("".equals(namespace)) {
            for (int i = nspCounts[depth];
                i < nspCounts[depth + 1];
                i++) {
                if ("".equals(nspStack[i * 2]) && !"".equals(nspStack[i * 2 + 1])) {
                    throw new IllegalStateException("Cannot set default namespace for elements in no namespace");
                }
            }
        }

        elementStack[esp++] = namespace;
        elementStack[esp++] = prefix;
        elementStack[esp] = name;

        writer.write('<');
        if (!"".equals(prefix)) {
            writer.write(prefix);
            writer.write(':');
        }

        writer.write(name);

        pending = true;

        return this;
    }

    public XmlSerializer attribute(
        String namespace,
        String name,
        String value)
        throws IOException {
        if (!pending)
            throw new IllegalStateException("illegal position for attribute");

        //        int cnt = nspCounts[depth];

        if (namespace == null)
            namespace = "";

        //		depth--;
        //		pending = false;

        String prefix =
            "".equals(namespace)
                ? ""
                : getPrefix(namespace, false, true);

        //		pending = true;
        //		depth++;

        /*        if (cnt != nspCounts[depth]) {
                    writer.write(' ');
                    writer.write("xmlns");
                    if (nspStack[cnt * 2] != null) {
                        writer.write(':');
                        writer.write(nspStack[cnt * 2]);
                    }
                    writer.write("=\"");
                    writeEscaped(nspStack[cnt * 2 + 1], '"');
                    writer.write('"');
                }
                */

        writer.write(' ');
        if (!"".equals(prefix)) {
            writer.write(prefix);
            writer.write(':');
        }
        writer.write(name);
        writer.write('=');
        char q = value.indexOf('"') == -1 ? '"' : '\'';
        writer.write(q);
        writeEscaped(value, q);
        writer.write(q);

        return this;
    }

    public void flush() throws IOException {
        check(false);
        writer.flush();
    }
    /*
    	public void close() throws IOException {
    		check();
    		writer.close();
    	}
    */
    public XmlSerializer endTag(String namespace, String name)
        throws IOException {

        if (!pending)
            depth--;
        //        if (namespace == null)
        //          namespace = "";

        if ((namespace == null
            && elementStack[depth * 3] != null)
            || (namespace != null
                && !namespace.equals(elementStack[depth * 3]))
            || !elementStack[depth * 3 + 2].equals(name))
            throw new IllegalArgumentException("</{"+namespace+"}"+name+"> does not match start");

        if (pending) {
            check(true);
            depth--;
        }
        else {
            if (indent[depth + 1]) {
                writer.write("\r\n");
                for (int i = 0; i < depth; i++)
                    writer.write("  ");
            }

            writer.write("</");
            String prefix = elementStack[depth * 3 + 1];
            if (!"".equals(prefix)) {
                writer.write(prefix);
                writer.write(':');
            }
            writer.write(name);
            writer.write('>');
        }

        nspCounts[depth + 1] = nspCounts[depth];
        return this;
    }

    public String getNamespace() {
        return getDepth() == 0 ? null : elementStack[getDepth() * 3 - 3];
    }

    public String getName() {
        return getDepth() == 0 ? null : elementStack[getDepth() * 3 - 1];
    }

    public int getDepth() {
        return pending ? depth + 1 : depth;
    }

    public XmlSerializer text(String text) throws IOException {
        check(false);
        indent[depth] = false;
        writeEscaped(text, -1);
        return this;
    }

    public XmlSerializer text(char[] text, int start, int len)
        throws IOException {
        text(new String(text, start, len));
        return this;
    }

    public void cdsect(String data) throws IOException {
        check(false);
        writer.write("<![CDATA[");
        writer.write(data);
        writer.write("]]>");
    }

    public void comment(String comment) throws IOException {
        check(false);
        writer.write("<!--");
        writer.write(comment);
        writer.write("-->");
    }

    public void processingInstruction(String pi)
        throws IOException {
        check(false);
        writer.write("<?");
        writer.write(pi);
        writer.write("?>");
    }
}
