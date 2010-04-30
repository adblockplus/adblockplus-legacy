/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * Draws a blinking border for a list of matching nodes.
 */

var flasher = {
  nodes: null,
  count: 0,
  timer: null,

  flash: function(nodes) {
    this.stop();
    if (!nodes || !nodes.length)
      return;

    if (Prefs.flash_scrolltoitem && ("document" in nodes[0] || nodes[0].ownerDocument)) {
      // Ensure that at least one node is visible when flashing
      var wnd = ("document" in nodes[0] ? nodes[0] : nodes[0].ownerDocument.defaultView);
      try {
        var viewer = wnd.QueryInterface(Ci.nsIInterfaceRequestor)
                        .getInterface(Ci.nsIWebNavigation)
                        .QueryInterface(Ci.nsIDocShellTreeItem)
                        .rootTreeItem
                        .QueryInterface(Ci.nsIInterfaceRequestor)
                        .getInterface(Ci.nsIDOMWindow)
                        .document.getElementById("abp-hooks")
                        .wrappedJSObject
                        .getBrowser()
                        .markupDocumentViewer;
        viewer.scrollToNode(nodes[0]);
      } catch(e) {}
    }

    this.nodes = nodes;
    this.count = 0;

    this.doFlash();
  },

  doFlash: function() {
    if (this.count >= 12) {
      this.stop();
      return;
    }

    if (this.count % 2)
      this.switchOff();
    else
      this.switchOn();

    this.count++;

    this.timer = window.setTimeout(function() {flasher.doFlash()}, 300);
  },

  stop: function() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.nodes) {
      this.switchOff();
      this.nodes = null;
    }
  },

  setOutline: function(value) {
    for (var i = 0; i < this.nodes.length; i++)
      if ("style" in this.nodes[i])
        this.nodes[i].style.outline = value;
  },

  switchOn: function() {
    this.setOutline("#CC0000 dotted 2px");
  },

  switchOff: function() {
    this.setOutline("none");
  }
};
