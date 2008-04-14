var document = {
  popupNode: null,
  tooltipNode: null,
  realDoc: Components.classes["@mozilla.org/xml/xml-document;1"].createInstance(Components.interfaces.nsIDOMXMLDocument),

  getElementById: function(id) {
    if (id == "abp-sidebar")
      return null;

    if (id == "contentAreaContextMenu")
      return gContextMenu;

    _element.id = id;
    return _element;
  },

  createElement: function(tagName) {
    return this.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tagName);
  },

  createElementNS: function(namespace, tagName) {
    return this.realDoc.createElementNS(namespace, tagName);
  }
}
