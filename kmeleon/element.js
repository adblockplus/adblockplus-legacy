var _element = {
  id: null,
  curState: null,
  lastAppended: null,
  style: {},
  get tagName() {
    if (this.id == "abp-status")
      return "statusbarpanel";
    if (this.id == "abp-toolbarbutton")
      return "toolbarbutton";

    return null;
  },

  get hidden() {
    return false;
  },
  set hidden(val) {
    if (this.id == "abp-status")
      hideStatusBar(val);
    else if (this.id in gContextMenu.abpItems && !val)
      addContextMenuItem(gContextMenu.abpItems[this.id]);
  },

  get parentNode() {
    return this;
  },

  hasAttribute: function(attr) {
    if (attr == "chromehidden")
      return true;

    return false;
  },
  getAttribute: function(attr) {
    if (attr == "chromehidden")
      return "extrachrome";
    else if (attr == "curstate")
      return this.curState;

    return null;
  },
  setAttribute: function(attr, value) {
    if (attr == "deactivated")
      this.setIconDelayed(1);
    else if (attr == "whitelisted")
      this.setIconDelayed(2);
    else if (attr == "curstate")
      this.curState = value;
    else if (attr == "value" && /^abp-tooltip-/.test(this.id))
      tooltipValue += value + "\n";
  },
  removeAttribute: function(attr) {
    if (attr == "deactivated" || attr == "whitelisted")
      this.setIconDelayed(0);
  },

  appendChild: function(child) {
    this.lastAppended = child;
  },
  getElementsByTagName: function(name) {
    return [this];
  },

  cloneNode: function() {
    if (this.id != "abp-key-sidebar")
      return null;

    abpConfigureKey("sidebar", abpPrefs.sidebar_key);
    return this.lastAppended;
  },

  icon: 0,
  setIconDelayed: function(icon) {
    var me = this;
    me.icon = icon;
    setTimeout(function() {
      setIcon(me.icon);
    }, 0);
  }
};
