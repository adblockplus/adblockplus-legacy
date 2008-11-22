var _browser = {
  selectListeners: [],

  get contentWindow() {
    return content;
  },
  addEventListener: function(event, handler, capture) {
    if (event == "select")
      this.selectListeners.push(handler);
  },
  removeEventListener: function(event, handler, capture) {
    if (event == "select")
      this.selectListeners = this.selectListeners.filter(function(item) {return item != handler});
  },
  notifySelectListeners: function() {
    for (var i = 0; i < this.selectListeners.length; i++)
      this.selectListeners[i].call(this, null);
  },
  addTab: function(url)
  {
    delayedOpenTab(url);
  }
}

function getBrowser() {
  return _browser;
}