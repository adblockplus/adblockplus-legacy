var document = {
  popupNode: null,
  tooltipNode: null,

  getElementById: function(id) {
    if (id == "abp-sidebar")
      return null;

    if (id == "contentAreaContextMenu")
      return gContextMenu;

    _element.id = id;
    return _element;
  },

  createElement: function(tagName) {
    return this.getElementById(null);
  }
}
