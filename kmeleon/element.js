var _element = {
  id: null,
  curState: null,
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

  appendChild: function() {},
  getElementsByTagName: function(name) {
    return [this];
  },

  setIconDelayed: function(icon) {
    setTimeout(function() {
      setIcon(icon);
    }, 0);
  }
};
