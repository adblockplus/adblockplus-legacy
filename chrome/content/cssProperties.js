function CSSPropertyFilters(window, addSelectorsFunc) {
  this.window = window;
  this.addSelectorsFunc = addSelectorsFunc;
}

CSSPropertyFilters.prototype = {
  stringifyStyle: function(style)
  {
    var styles = [];
    for (var i = 0; i < style.length; i++)
    {
      var property = style.item(i);
      var value    = style.getPropertyValue(property);
      var priority = style.getPropertyPriority(property);
      styles.push(property + ": " + value + (priority ? " !" + priority : "") + ";");
    }
    styles.sort();
    return styles.join(" ");
  },

  findSelectors: function(stylesheet, selectors)
  {
    var rules = stylesheet.cssRules;
    if (!rules)
      return;

    for (var i = 0; i < rules.length; i++)
    {
      var rule = rules[i];
      if (rule.type != this.window.CSSRule.STYLE_RULE)
        continue;

      var style = this.stringifyStyle(rule.style);
      for (var j = 0; j < this.patterns.length; j++)
      {
        var pattern = this.patterns[j];
        var regexp = pattern.regexp;

        if (typeof regexp == "string")
          regexp = pattern.regexp = new RegExp(regexp);

        if (regexp.test(style))
          selectors.push(pattern.prefix + rule.selectorText + pattern.suffix);
      }
    }
  },

  addSelectors: function(stylesheets)
  {
    var selectors = [];
    for (var i = 0; i < stylesheets.length; i++)
      this.findSelectors(stylesheets[i], selectors);
    this.addSelectorsFunc(selectors);
  },

  onLoad: function(event)
  {
    var stylesheet = event.target.sheet;
    if (stylesheet)
      this.addSelectors([stylesheet]);
  },

  load: function(callback)
  {
    ext.backgroundPage.sendMessage(
      {
        type: "filters.get",
        what: "cssproperties"
      },
      function(patterns)
      {
        this.patterns = patterns;
        callback();
      }.bind(this)
    );
  },

  apply: function()
  {
    if (this.patterns.length > 0)
    {
      var document = this.window.document;
      this.addSelectors(document.styleSheets);
      document.addEventListener("load", this.onLoad.bind(this), true);
    }
  }
};
