/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/**
 * Draws a blinking border for a list of matching nodes.
 */

var flasher = {
  nodes: null,
  count: 0,
  timer: null,

  flash: function(nodes)
  {
    this.stop();
    if (nodes)
      nodes = nodes.filter(function(node) node.nodeType == Node.ELEMENT_NODE);
    if (!nodes || !nodes.length)
      return;

    if (Prefs.flash_scrolltoitem && nodes[0].ownerDocument)
    {
      // Ensure that at least one node is visible when flashing
      let wnd = nodes[0].ownerDocument.defaultView;
      try
      {
        let hooks = wnd.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIWebNavigation)
                       .QueryInterface(Ci.nsIDocShellTreeItem)
                       .rootTreeItem
                       .QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIDOMWindow)
                       .document.getElementById("abp-hooks");
        if (hooks.wrappedJSObject)
          hooks = hooks.wrappedJSObject;
                        
        let viewer = hooks.getBrowser().markupDocumentViewer;
        viewer.scrollToNode(nodes[0]);
      }
      catch(e)
      {
        Cu.reportError(e);
      }
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

  setOutline: function(outline, offset)
  {
    for (var i = 0; i < this.nodes.length; i++)
    {
      if ("style" in this.nodes[i])
      {
        this.nodes[i].style.outline = outline;
        this.nodes[i].style.outlineOffset = offset;
      }
    }
  },

  switchOn: function()
  {
    this.setOutline("#CC0000 dotted 2px", "-2px");
  },

  switchOff: function()
  {
    this.setOutline("", "");
  }
};
