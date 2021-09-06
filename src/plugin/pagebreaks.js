import Worker from '../worker.js';
import { createElement } from '../utils.js';

/* Pagebreak plugin:

    Adds page-break functionality to the html2pdf library. Page-breaks can be
    enabled by CSS styles, set on individual elements using selectors, or
    avoided from breaking inside all elements.

    Options on the `opt.pagebreak` object:

    mode:   String or array of strings: 'avoid-all', 'css', and/or 'legacy'
            Default: ['css', 'legacy']

    before: String or array of CSS selectors for which to add page-breaks
            before each element. Can be a specific element with an ID
            ('#myID'), all elements of a type (e.g. 'img'), all of a class
            ('.myClass'), or even '*' to match every element.

    after:  Like 'before', but adds a page-break immediately after the element.

    avoid:  Like 'before', but avoids page-breaks on these elements. You can
            enable this feature on every element using the 'avoid-all' mode.
*/

// Refs to original functions.
var orig = {
  toContainer: Worker.prototype.toContainer
};

// Add pagebreak default options to the Worker template.
Worker.template.opt.pagebreak = {
  mode: ['css', 'legacy'],
  before: [],
  after: [],
  avoid: []
};

/* Add opiniated unique id (uid) to all elements in the body:
	UIDs are needed for to reference elements when break after
	Break afters will be executed after all the elements in the node tree of the elemement after we should break have been cycled through

	UIDs for elements are created like:
	body (0)
		> child (00)
		> child (01)
			> child (010)
			> child (011)
				> child (0110)
				...
			> child (012)
			...
*/
Worker.prototype.addUIDRecursive = function(element, uid = 0) {
	const childrenArr = [...element.children]
	element.setAttribute('uid', uid)


	if (childrenArr.length)
		childrenArr.forEach((childElement, index) => {
			this.addUIDRecursive(childElement, `${element.getAttribute('uid')}${index}`)
		})
}

Worker.prototype.toContainer = function toContainer() {
  return orig.toContainer.call(this).then(function toContainer_pagebreak() {
    // Setup root element and inner page height.
    var root = this.prop.container;
    var pxPageHeight = this.prop.pageSize.inner.px.height;

    // Check all requested modes.
    var modeSrc = [].concat(this.opt.pagebreak.mode);
    var mode = {
      avoidAll:   modeSrc.indexOf('avoid-all') !== -1,
      css:        modeSrc.indexOf('css') !== -1,
      legacy:     modeSrc.indexOf('legacy') !== -1
    };

    // Get arrays of all explicitly requested elements.
    var select = {};
    var self = this;
    ['before', 'after', 'avoid'].forEach(function(key) {
      var all = mode.avoidAll && key === 'avoid';
      select[key] = all ? [] : [].concat(self.opt.pagebreak[key] || []);
      if (select[key].length > 0) {
        select[key] = Array.prototype.slice.call(
          root.querySelectorAll(select[key].join(', ')));
      }
    });

    // Get all legacy page-break elements.
    var legacyEls = root.querySelectorAll('.html2pdf__page-break');
    legacyEls = Array.prototype.slice.call(legacyEls);

		// Add uids to elements needed for breakAfter
		this.addUIDRecursive(root)

		// Array to keep breakAfter functions to be executed
		// Example element in array:
		// [uid1, fn, boolean (fn executed?)]
		var breakAfter = [];

		// Returns breakAfters that requires execution
		function pendingBreakAfters(currentEl) {
			return breakAfter
				.filter(([_, __, executed]) => !executed)
				.filter(([uid]) => !currentEl.getAttribute('uid').startsWith(uid))
				.reverse()
		}

    // Loop through all elements.
    var els = root.querySelectorAll('*');
    Array.prototype.forEach.call(els, function pagebreak_loop(el) {
			var uid = el.getAttribute('uid');
			
      // Setup pagebreak rules based on legacy and avoidAll modes.
      var rules = {
        before: false,
        after:  mode.legacy && legacyEls.indexOf(el) !== -1,
        avoid:  mode.avoidAll
      };

      // Add rules for css mode.
      if (mode.css) {
        // TODO: Check if this is valid with iFrames.
        var style = window.getComputedStyle(el);
        // TODO: Handle 'left' and 'right' correctly.
        // TODO: Add support for 'avoid' on breakBefore/After.
        var breakOpt = ['always', 'page', 'left', 'right'];
        var avoidOpt = ['avoid', 'avoid-page'];
        rules = {
          before: rules.before || breakOpt.indexOf(style.breakBefore || style.pageBreakBefore) !== -1,
          after:  rules.after || breakOpt.indexOf(style.breakAfter || style.pageBreakAfter) !== -1,
          avoid:  rules.avoid || avoidOpt.indexOf(style.breakInside || style.pageBreakInside) !== -1
        };
      }

      // Add rules for explicit requests.
      Object.keys(rules).forEach(function(key) {
        rules[key] = rules[key] || select[key].indexOf(el) !== -1;
      });
		
			// After: Execute the pendingBreak functions & push 'true' so that next time the function is filtered out
			pendingBreakAfters(el).forEach((arr) => {
				arr[1]()
				arr[2] = true
			})

      // After: (wrap in a function to be executed later) Create a padding div to fill the remaining page
      if (rules.after) {
				breakAfter.push(
					[
						uid, 
						() => {
							const style = {
								height: (pxPageHeight - el.getBoundingClientRect().bottom % pxPageHeight) + 'px',
								display: 'block'
							}
							var pad = createElement('div', { style });
							el.parentNode.insertBefore(pad, el.nextSibling);
						},
						false
					]
				)
      }

      // Get element position on the screen.
      // TODO: Subtract the top of the container from clientRect.top/bottom?
      var clientRect = el.getBoundingClientRect();

      // Avoid: Check if a break happens mid-element.
      if (rules.avoid && !rules.before) {
        var startPage = Math.floor(clientRect.top / pxPageHeight);
        var endPage = Math.floor((clientRect.bottom - 1) / pxPageHeight);
        var nPages = Math.abs(clientRect.bottom - clientRect.top) / pxPageHeight;

        // Turn on rules.before if the el is broken and is at most one page long.
        if (endPage !== startPage && nPages <= 1) {
          rules.before = true;
        }
      }

      // Before: Create a padding div to push the element to the next page.
      if (rules.before) {
        var pad = createElement('div', {style: {
          display: 'block',
          height: pxPageHeight - (clientRect.top % pxPageHeight) + 'px'
        }});
        el.parentNode.insertBefore(pad, el);
      }

    });
  });
};
