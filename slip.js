"use strict";
/// <reference path="./slip.d.ts" />
Object.defineProperty(exports, "__esModule", { value: true });
/*
    Slip - swiping and reordering in lists of elements on touch screens, no fuss.

    Fires these events on list elements:

        • slip:swipe
            When swipe has been done and user has lifted finger off the screen.
            If you execute event.preventDefault() the element will be animated back to original position.
            Otherwise it will be animated off the list and set to display:none.

        • slip:beforeswipe
            Fired before first swipe movement starts.
            If you execute event.preventDefault() then element will not move at all.

        • slip:cancelswipe
            Fired after the user has started to swipe, but lets go without actually swiping left or right.

        • slip:animateswipe
            Fired while swiping, before the user has let go of the element.
            event.detail.x contains the amount of movement in the x direction.
            If you execute event.preventDefault() then the element will not move to this position.
            This can be useful for saturating the amount of swipe, or preventing movement in one direction, but allowing it in the other.

        • slip:reorder
            Element has been dropped in new location. event.detail contains the following:
                • insertBefore: DOM node before which element has been dropped (null is the end of the list). Use with node.insertBefore().
                • spliceIndex: Index of element before which current element has been dropped, not counting the element iself.
                               For use with Array.splice() if the list is reflecting objects in some array.
                • originalIndex: The original index of the element before it was reordered.

        • slip:beforereorder
            When reordering movement starts.
            Element being reordered gets class `slip-reordering`.
            If you execute event.preventDefault() then the element will not move at all.

        • slip:beforewait
            If you execute event.preventDefault() then reordering will begin immediately, blocking ability to scroll the page.

        • slip:tap
            When element was tapped without being swiped/reordered. You can check `event.target` to limit that behavior to drag handles.


    Usage:

        CSS:
            You should set `user-select:none` (and WebKit prefixes, sigh) on list elements,
            otherwise unstoppable and glitchy text selection in iOS will get in the way.

            You should set `overflow-x: hidden` on the container or body to prevent horizontal scrollbar
            appearing when elements are swiped off the list.


        const list = document.querySelector('ul#slippylist');
        new Slip(list);

        list.addEventListener('slip:beforeswipe', e => {
            if (shouldNotSwipe(e.target)) e.preventDefault();
        });

        list.addEventListener('slip:swipe', e => {
            // e.target swiped
            if (thatWasSwipeToRemove) {
                e.target.parentNode.removeChild(e.target);
            } else {
                e.preventDefault(); // will animate back to original position
            }
        });

        list.addEventListener('slip:beforereorder', e => {
            if (shouldNotReorder(e.target)) e.preventDefault();
        });

        list.addEventListener('slip:reorder', e => {
            // e.target reordered.
            if (reorderedOK) {
                e.target.parentNode.insertBefore(e.target, e.detail.insertBefore);
            } else {
                e.preventDefault();
            }
        });

    Requires:
        • Touch events
        • CSS transforms
        • Function.bind()

    Caveats:
        • Elements must not change size while reordering or swiping takes place (otherwise it will be visually out of sync)
*/
/*! @license
    Slip.js 1.2.0

    © 2014 Kornel Lesiński <kornel@geekhood.net>. All rights reserved.

    Redistribution and use in source and binary forms, with or without modification,
    are permitted provided that the following conditions are met:

    1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
       the following disclaimer in the documentation and/or other materials provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
    INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
    DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
    SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
    WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE
    USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
exports.Slip = function () {
    var _this = this;
    var accessibility = {
        // Set values to false if you don't want Slip to manage them
        container: {
            ariaRole: 'listbox',
            tabIndex: 0,
            focus: false,
        },
        items: {
            ariaRole: 'option',
            tabIndex: -1,
            focus: false,
        },
    };
    var damnYouChrome = /Chrome\/[3-5]/.test(navigator.userAgent); // For bugs that can't be programmatically detected :( Intended to catch all versions of Chrome 30-40
    var needsBodyHandlerHack = damnYouChrome; // Otherwise I _sometimes_ don't get any touchstart events and only clicks instead.
    /* When dragging elements down in Chrome (tested 34-37) dragged element may appear below stationary elements.
       Looks like WebKit bug #61824, but iOS Safari doesn't have that problem. */
    var compositorDoesNotOrderLayers = damnYouChrome;
    // -webkit-mess
    var testElementStyle = document.createElement('div').style;
    var transitionJSPropertyName = 'transition' in testElementStyle ? 'transition' : 'webkitTransition';
    var transformJSPropertyName = 'transform' in testElementStyle ? 'transform' : 'webkitTransform';
    var transformCSSPropertyName = transformJSPropertyName === 'webkitTransform' ? '-webkit-transform' : 'transform';
    var userSelectJSPropertyName = 'userSelect' in testElementStyle ? 'userSelect' : 'webkitUserSelect';
    testElementStyle[transformJSPropertyName] = 'translateZ(0)';
    var hwLayerMagicStyle = testElementStyle[transformJSPropertyName] ? 'translateZ(0) ' : '';
    var hwTopLayerMagicStyle = testElementStyle[transformJSPropertyName] ? 'translateZ(1px) ' : '';
    testElementStyle = null;
    var globalInstances = 0;
    var attachedBodyHandlerHack = false;
    var nullHandler = function () { };
    var Slip = function (container, options) {
        if ('string' === typeof container)
            container = document.querySelector(container);
        if (!container || !container.addEventListener)
            throw new Error('Please specify DOM node to attach to');
        if (!this || this === window)
            return new Slip(container, options);
        this.options = options = options || {};
        this.options.keepSwipingPercent = options.keepSwipingPercent || 0;
        this.options.minimumSwipeVelocity = options.minimumSwipeVelocity || 1;
        this.options.minimumSwipeTime = options.minimumSwipeTime || 110;
        this.options.ignoredElements = options.ignoredElements || [];
        if (!Array.isArray(this.options.ignoredElements))
            throw new Error('ignoredElements must be an Array');
        // Functions used for as event handlers need usable `this` and must not change to be removable
        this.cancel = this.setState.bind(this, this.states.idle);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseLeave = this.onMouseLeave.bind(this);
        this.onSelection = this.onSelection.bind(this);
        this.onContainerFocus = this.onContainerFocus.bind(this);
        this.setState(this.states.idle);
        this.attach(container);
        return this;
    };
    var getTransform = function (node) {
        var transform = node.style[transformJSPropertyName];
        if (transform) {
            return {
                value: transform,
                original: transform,
            };
        }
        if (window.getComputedStyle) {
            var style = window.getComputedStyle(node).getPropertyValue(transformCSSPropertyName);
            if (style && style !== 'none')
                return { value: style, original: '' };
        }
        return { value: '', original: '' };
    };
    var findIndex = function (target, nodes) {
        var originalIndex = 0;
        var listCount = 0;
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType === 1) {
                listCount++;
                if (nodes[i] === target.node) {
                    originalIndex = listCount - 1;
                }
            }
        }
        return originalIndex;
    };
    // All functions in states are going to be executed in context of Slip object
    Slip.prototype = {
        container: null,
        options: {},
        state: null,
        target: null,
        usingTouch: false,
        mouseHandlersAttached: false,
        startPosition: null,
        latestPosition: null,
        previousPosition: null,
        canPreventScrolling: false,
        states: {
            idle: function idleStateInit() {
                this.removeMouseHandlers();
                if (this.target) {
                    this.target.node.style.willChange = '';
                    this.target = null;
                }
                this.usingTouch = false;
                return {
                    allowTextSelection: true,
                };
            },
            undecided: function undecidedStateInit() {
                var _this = this;
                this.target.height = this.target.node.offsetHeight;
                this.target.node.style.willChange = transformCSSPropertyName;
                this.target.node.style[transitionJSPropertyName] = '';
                var holdTimer = 0;
                if (!this.dispatch(this.target.originalTarget, 'beforewait')) {
                    if (this.dispatch(this.target.originalTarget, 'beforereorder')) {
                        this.setState(this.states.reorder);
                    }
                }
                else {
                    holdTimer = setTimeout(function () {
                        var move = _this.getAbsoluteMovement();
                        if (_this.canPreventScrolling && move.x < 15 && move.y < 25) {
                            if (_this.dispatch(_this.target.originalTarget, 'beforereorder')) {
                                _this.setState(_this.states.reorder);
                            }
                        }
                    }, 300);
                }
                return {
                    leaveState: function () { return clearTimeout(holdTimer); },
                    onMove: function () {
                        var move = _this.getAbsoluteMovement();
                        if (move.x > 20 && move.y < Math.max(100, _this.target.height || 0)) {
                            if (_this.dispatch(_this.target.originalTarget, 'beforeswipe', {
                                directionX: move.directionX,
                                directionY: move.directionY
                            })) {
                                _this.setState(_this.states.swipe);
                                return false;
                            }
                            else {
                                _this.setState(_this.states.idle);
                            }
                        }
                        if (move.y > 20) {
                            _this.setState(_this.states.idle);
                        }
                        // Chrome likes sideways scrolling :(
                        if (move.x > move.y * 1.2)
                            return false;
                    },
                    onLeave: function () { return _this.setState(_this.states.idle); },
                    onEnd: function () {
                        var allowDefault = _this.dispatch(_this.target.originalTarget, 'tap');
                        _this.setState(_this.states.idle);
                        return allowDefault;
                    },
                };
            },
            swipe: function () {
                var swipeSuccess = false;
                var container = _this.container;
                var originalIndex = findIndex(_this.target, _this.container.childNodes);
                container.classList.add('slip-swiping-container');
                var removeClass = function () { return container.classList.remove('slip-swiping-container'); };
                _this.target.height = _this.target.node.offsetHeight;
                return {
                    leaveState: function () {
                        if (swipeSuccess) {
                            _this.animateSwipe(function (target) {
                                target.node.style[transformJSPropertyName] = target.baseTransform.original;
                                target.node.style[transitionJSPropertyName] = '';
                                if (_this.dispatch(target.node, 'afterswipe')) {
                                    removeClass();
                                    return true;
                                }
                                else {
                                    _this.animateToZero(undefined, target);
                                }
                            });
                        }
                        else {
                            _this.animateToZero(removeClass);
                        }
                    },
                    onMove: function () {
                        var move = _this.getTotalMovement();
                        if (_this.target.height && Math.abs(move.y) < _this.target.height + 20) {
                            if (_this.dispatch(_this.target.node, 'animateswipe', {
                                x: move.x,
                                originalIndex: originalIndex
                            })) {
                                _this.target.node.style[transformJSPropertyName] = 'translate(' + move.x + 'px,0) ' + hwLayerMagicStyle + _this.target.baseTransform.value;
                            }
                            return false;
                        }
                        else {
                            _this.dispatch(_this.target.node, 'cancelswipe');
                            _this.setState(_this.states.idle);
                        }
                    },
                    onLeave: _this.state.onEnd,
                    onEnd: function () {
                        var move = _this.getAbsoluteMovement();
                        var velocity = move.x / move.time;
                        // How far out has the item been swiped?
                        var swipedPercent = Math.abs((_this.startPosition.x - _this.previousPosition.x) / _this.container.clientWidth) * 100;
                        var swiped = (velocity > _this.options.minimumSwipeVelocity && move.time > _this.options.minimumSwipeTime) || (_this.options.keepSwipingPercent && swipedPercent > _this.options.keepSwipingPercent);
                        if (swiped) {
                            if (_this.dispatch(_this.target.node, 'swipe', {
                                direction: move.directionX,
                                originalIndex: originalIndex
                            })) {
                                swipeSuccess = true; // can't animate here, leaveState overrides anim
                            }
                        }
                        else {
                            _this.dispatch(_this.target.node, 'cancelswipe');
                        }
                        _this.setState(_this.states.idle);
                        return !swiped;
                    },
                };
            },
            reorder: function () {
                if (_this.target.node.focus && accessibility.items.focus) {
                    _this.target.node.focus();
                }
                _this.target.height = _this.target.node.offsetHeight;
                var nodes;
                if (_this.options.ignoredElements.length) {
                    var container = _this.container;
                    var query_1 = container.tagName.toLowerCase();
                    if (container.getAttribute('id')) {
                        query_1 = '#' + container.getAttribute('id');
                    }
                    else if (container.classList.length) {
                        query_1 += '.' + container.getAttribute('class')
                            .replace(' ', '.');
                    }
                    query_1 += ' > ';
                    _this.options.ignoredElements.forEach(function (selector) {
                        query_1 += ':not(' + selector + ')';
                    });
                    try {
                        nodes = container.parentNode.querySelectorAll(query_1);
                    }
                    catch (err) {
                        if (err instanceof DOMException && err.name === 'SyntaxError')
                            throw new Error('ignoredElements you specified contain invalid query');
                        else
                            throw err;
                    }
                }
                else {
                    nodes = _this.container.childNodes;
                }
                var originalIndex = findIndex(_this.target, nodes);
                var mouseOutsideTimer;
                var zero = _this.target.node.offsetTop + _this.target.height / 2;
                var otherNodes = [];
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i].nodeType != 1 || nodes[i] === _this.target.node)
                        continue;
                    var t = nodes[i].offsetTop;
                    nodes[i].style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.2s ease-in-out';
                    otherNodes.push({
                        node: nodes[i],
                        baseTransform: getTransform(nodes[i]),
                        pos: t + (t < zero ? nodes[i].offsetHeight : 0) - zero,
                    });
                }
                _this.target.node.classList.add('slip-reordering');
                _this.target.node.style.zIndex = '99999';
                _this.target.node.style[userSelectJSPropertyName] = 'none';
                if (compositorDoesNotOrderLayers) {
                    // Chrome's compositor doesn't sort 2D layers
                    _this.container.style.webkitTransformStyle = 'preserve-3d';
                }
                var onMove = function () {
                    /*jshint validthis:true */
                    _this.updateScrolling();
                    if (mouseOutsideTimer) {
                        // don't care where the mouse is as long as it moves
                        clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = null;
                    }
                    var move = _this.getTotalMovement();
                    _this.target.node.style[transformJSPropertyName] = 'translate(0,' + move.y + 'px) ' + hwTopLayerMagicStyle + _this.target.baseTransform.value;
                    var height = _this.target.height || 0;
                    otherNodes.forEach(function (o) {
                        var off = 0;
                        if (o.pos < 0 && move.y < 0 && o.pos > move.y) {
                            off = height;
                        }
                        else if (o.pos > 0 && move.y > 0 && o.pos < move.y) {
                            off = -height;
                        }
                        // FIXME: should change accelerated/non-accelerated state lazily
                        o.node.style[transformJSPropertyName] = off ? 'translate(0,' + off + 'px) ' + hwLayerMagicStyle + o.baseTransform.value : o.baseTransform.original;
                    });
                    return false;
                };
                onMove();
                return {
                    leaveState: function () {
                        if (mouseOutsideTimer)
                            clearTimeout(mouseOutsideTimer);
                        if (compositorDoesNotOrderLayers) {
                            _this.container.style.webkitTransformStyle = '';
                        }
                        if (_this.container.focus && accessibility.container.focus) {
                            _this.container.focus();
                        }
                        _this.target.node.classList.remove('slip-reordering');
                        _this.target.node.style[userSelectJSPropertyName] = '';
                        _this.animateToZero(function (target) { return target.node.style.zIndex = ''; });
                        otherNodes.forEach(function (o) {
                            o.node.style[transformJSPropertyName] = o.baseTransform.original;
                            o.node.style[transitionJSPropertyName] = ''; // FIXME: animate to new position
                        });
                    },
                    onMove: onMove,
                    onLeave: function () {
                        // don't let element get stuck if mouse left the window
                        // but don't cancel immediately as it'd be annoying near window edges
                        if (mouseOutsideTimer)
                            clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = setTimeout(function () {
                            mouseOutsideTimer = null;
                            _this.cancel();
                        }, 700);
                    },
                    onEnd: function () {
                        var move = _this.getTotalMovement();
                        var i, spliceIndex;
                        if (move.y < 0) {
                            for (i = 0; i < otherNodes.length; i++) {
                                if (otherNodes[i].pos > move.y) {
                                    break;
                                }
                            }
                            spliceIndex = i;
                        }
                        else {
                            for (i = otherNodes.length - 1; i >= 0; i--) {
                                if (otherNodes[i].pos < move.y) {
                                    break;
                                }
                            }
                            spliceIndex = i + 1;
                        }
                        _this.dispatch(_this.target.node, 'reorder', {
                            spliceIndex: spliceIndex,
                            originalIndex: originalIndex,
                            insertBefore: otherNodes[spliceIndex] ? otherNodes[spliceIndex].node : undefined,
                        });
                        _this.setState(_this.states.idle);
                        return false;
                    },
                };
            },
        },
        attach: function (container) {
            globalInstances++;
            if (_this.container)
                _this.detach();
            // In some cases taps on list elements send *only* click events and no touch events. Spotted only in Chrome 32+
            // Having event listener on body seems to solve the issue (although AFAIK may disable smooth scrolling as a side-effect)
            if (!attachedBodyHandlerHack && needsBodyHandlerHack) {
                attachedBodyHandlerHack = true;
                document.body.addEventListener('touchstart', nullHandler, false);
            }
            _this.container = container;
            // Accessibility
            if (false !== accessibility.container.tabIndex) {
                _this.container.tabIndex = accessibility.container.tabIndex;
            }
            if (accessibility.container.ariaRole) {
                _this.container.setAttribute('aria-role', accessibility.container.ariaRole);
            }
            _this.setChildNodesAriaRoles();
            _this.container.addEventListener('focus', _this.onContainerFocus, false);
            _this.otherNodes = [];
            // selection on iOS interferes with reordering
            document.addEventListener('selectionchange', _this.onSelection, false);
            // cancel is called e.g. when iOS detects multitasking gesture
            _this.container.addEventListener('touchcancel', _this.cancel, false);
            _this.container.addEventListener('touchstart', _this.onTouchStart, false);
            _this.container.addEventListener('touchmove', _this.onTouchMove, false);
            _this.container.addEventListener('touchend', _this.onTouchEnd, false);
            _this.container.addEventListener('mousedown', _this.onMouseDown, false);
            // mousemove and mouseup are attached dynamically
        },
        detach: function () {
            _this.cancel();
            _this.container.removeEventListener('mousedown', _this.onMouseDown, false);
            _this.container.removeEventListener('touchend', _this.onTouchEnd, false);
            _this.container.removeEventListener('touchmove', _this.onTouchMove, false);
            _this.container.removeEventListener('touchstart', _this.onTouchStart, false);
            _this.container.removeEventListener('touchcancel', _this.cancel, false);
            document.removeEventListener('selectionchange', _this.onSelection, false);
            if (false !== accessibility.container.tabIndex) {
                _this.container.removeAttribute('tabIndex');
            }
            if (accessibility.container.ariaRole) {
                _this.container.removeAttribute('aria-role');
            }
            _this.unSetChildNodesAriaRoles();
            globalInstances--;
            if (!globalInstances && attachedBodyHandlerHack) {
                attachedBodyHandlerHack = false;
                document.body.removeEventListener('touchstart', nullHandler, false);
            }
        },
        setState: function (newStateCtor) {
            if (_this.state) {
                if (_this.state.ctor === newStateCtor)
                    return;
                if (_this.state.leaveState)
                    _this.state.leaveState.call(_this);
            }
            // Must be re-entrant in case ctor changes state
            var prevState = _this.state;
            var nextState = newStateCtor.call(_this);
            if (_this.state === prevState) {
                nextState.ctor = newStateCtor;
                _this.state = nextState;
            }
        },
        findTargetNode: function (targetNode) {
            while (targetNode && targetNode.parentNode !== _this.container) {
                if (targetNode.parentNode != null)
                    targetNode = targetNode.parentNode;
            }
            return targetNode;
        },
        onContainerFocus: function (e) {
            e.stopPropagation();
            _this.setChildNodesAriaRoles();
        },
        setChildNodesAriaRoles: function () {
            var nodes = _this.container.childNodes;
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].nodeType != 1)
                    continue;
                if (accessibility.items.ariaRole) {
                    nodes[i].setAttribute('aria-role', accessibility.items.ariaRole);
                }
                if (false !== accessibility.items.tabIndex) {
                    nodes[i].tabIndex = accessibility.items.tabIndex;
                }
            }
        },
        unSetChildNodesAriaRoles: function () {
            var nodes = _this.container.childNodes;
            for (var i = 0; i < nodes.length; i++) {
                if (nodes[i].nodeType != 1)
                    continue;
                if (accessibility.items.ariaRole) {
                    nodes[i].removeAttribute('aria-role');
                }
                if (false !== accessibility.items.tabIndex) {
                    nodes[i].removeAttribute('tabIndex');
                }
            }
        },
        onSelection: function (e) {
            e.stopPropagation();
            var isRelated = e.target === document || _this.findTargetNode(e);
            var iOS = /(iPhone|iPad|iPod)/i.test(navigator.userAgent) && !/(Android|Windows)/i.test(navigator.userAgent);
            if (!isRelated)
                return;
            if (iOS) {
                // iOS doesn't allow selection to be prevented
                _this.setState(_this.states.idle);
            }
            else {
                if (!_this.state.allowTextSelection) {
                    e.preventDefault();
                }
            }
        },
        addMouseHandlers: function () {
            // unlike touch events, mousemove/up is not conveniently fired on the same element,
            // but I don't need to listen to unrelated events all the time
            if (!_this.mouseHandlersAttached) {
                _this.mouseHandlersAttached = true;
                document.documentElement.addEventListener('mouseleave', _this.onMouseLeave, false);
                window.addEventListener('mousemove', _this.onMouseMove, true);
                window.addEventListener('mouseup', _this.onMouseUp, true);
                window.addEventListener('blur', _this.cancel, false);
            }
        },
        removeMouseHandlers: function () {
            if (_this.mouseHandlersAttached) {
                _this.mouseHandlersAttached = false;
                document.documentElement.removeEventListener('mouseleave', _this.onMouseLeave, false);
                window.removeEventListener('mousemove', _this.onMouseMove, true);
                window.removeEventListener('mouseup', _this.onMouseUp, true);
                window.removeEventListener('blur', _this.cancel, false);
            }
        },
        onMouseLeave: function (e) {
            e.stopPropagation();
            if (_this.usingTouch)
                return;
            if (e.target === document.documentElement || e.relatedTarget === document.documentElement) {
                if (_this.state.onLeave) {
                    _this.state.onLeave.call(_this);
                }
            }
        },
        onMouseDown: function (e) {
            e.stopPropagation();
            if (_this.usingTouch || e.button != 0 || !_this.setTarget(e))
                return;
            _this.addMouseHandlers(); // mouseup, etc.
            _this.canPreventScrolling = true; // or rather it doesn't apply to mouse
            _this.startAtPosition({
                x: e.clientX,
                y: e.clientY,
                time: e.timeStamp,
            });
        },
        onTouchStart: function (e) {
            e.stopPropagation();
            _this.usingTouch = true;
            _this.canPreventScrolling = true;
            // This implementation cares only about single touch
            if (e.touches.length > 1) {
                _this.setState(_this.states.idle);
                return;
            }
            if (e.target != null && !_this.setTarget(e))
                return;
            _this.startAtPosition({
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: e.timeStamp,
            });
        },
        setTarget: function (e) {
            var targetNode = _this.findTargetNode(e.target);
            if (!targetNode) {
                _this.setState(_this.states.idle);
                return false;
            }
            //check for a scrollable parent
            var scrollContainer = targetNode.parentNode;
            while (scrollContainer) {
                if (scrollContainer == document.body)
                    break;
                if (scrollContainer.scrollHeight > scrollContainer.clientHeight && window.getComputedStyle(scrollContainer).overflowY !== 'visible')
                    break;
                scrollContainer = scrollContainer.parentNode;
            }
            scrollContainer = scrollContainer || document.body;
            _this.target = {
                originalTarget: e.target,
                node: targetNode,
                scrollContainer: scrollContainer,
                origScrollTop: scrollContainer.scrollTop,
                origScrollHeight: scrollContainer.scrollHeight,
                baseTransform: getTransform(targetNode),
            };
            return true;
        },
        startAtPosition: function (pos) {
            _this.startPosition = _this.previousPosition = _this.latestPosition = pos;
            _this.setState(_this.states.undecided);
        },
        updatePosition: function (e, pos) {
            if (_this.target == null) {
                return;
            }
            _this.latestPosition = pos;
            if (_this.state.onMove) {
                if (_this.state.onMove.call(_this) === false) {
                    e.preventDefault();
                }
            }
            // sample latestPosition 100ms for velocity
            if (_this.latestPosition.time - _this.previousPosition.time > 100) {
                _this.previousPosition = _this.latestPosition;
            }
        },
        onMouseMove: function (e) {
            e.stopPropagation();
            _this.updatePosition(e, {
                x: e.clientX,
                y: e.clientY,
                time: e.timeStamp,
            });
        },
        onTouchMove: function (e) {
            e.stopPropagation();
            _this.updatePosition(e, {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY,
                time: e.timeStamp,
            });
            // In Apple's touch model only the first move event after touchstart can prevent scrolling (and event.cancelable is broken)
            _this.canPreventScrolling = false;
        },
        onMouseUp: function (e) {
            e.stopPropagation();
            if (_this.usingTouch || e.button !== 0)
                return;
            if (_this.state.onEnd && false === _this.state.onEnd.call(_this)) {
                e.preventDefault();
            }
        },
        onTouchEnd: function (e) {
            e.stopPropagation();
            if (e.touches.length > 1) {
                _this.cancel();
            }
            else if (_this.state.onEnd && false === _this.state.onEnd.call(_this)) {
                e.preventDefault();
            }
        },
        getTotalMovement: function () {
            var scrollOffset = _this.target.scrollContainer.scrollTop - _this.target.origScrollTop;
            return {
                x: _this.latestPosition.x - _this.startPosition.x,
                y: _this.latestPosition.y - _this.startPosition.y + scrollOffset,
                time: _this.latestPosition.time - _this.startPosition.time,
            };
        },
        getAbsoluteMovement: function () {
            var move = _this.getTotalMovement();
            return {
                x: Math.abs(move.x),
                y: Math.abs(move.y),
                time: move.time,
                directionX: move.x < 0 ? 'left' : 'right',
                directionY: move.y < 0 ? 'up' : 'down',
            };
        },
        updateScrolling: function () {
            var triggerOffset = 40;
            var offset = 0;
            var scrollable = _this.target.scrollContainer, containerRect = scrollable.getBoundingClientRect(), targetRect = _this.target.node.getBoundingClientRect(), bottomOffset = Math.min(containerRect.bottom, window.innerHeight) - targetRect.bottom, topOffset = targetRect.top - Math.max(containerRect.top, 0), maxScrollTop = _this.target.origScrollHeight - Math.min(scrollable.clientHeight, window.innerHeight);
            if (bottomOffset < triggerOffset) {
                offset = Math.min(triggerOffset, triggerOffset - bottomOffset);
            }
            else if (topOffset < triggerOffset) {
                offset = Math.max(-triggerOffset, topOffset - triggerOffset);
            }
            scrollable.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollable.scrollTop + offset));
        },
        dispatch: function (targetNode, eventName, detail) {
            var event = document.createEvent('CustomEvent');
            if (event && event.initCustomEvent) {
                event.initCustomEvent('slip:' + eventName, true, true, detail);
            }
            else {
                event = document.createEvent('Event');
                event.initEvent('slip:' + eventName, true, true);
                // event.detail = detail;
            }
            return targetNode.dispatchEvent(event);
        },
        getSiblings: function (target) {
            var siblings = [];
            var tmp = target.node.nextSibling;
            while (tmp) {
                if (tmp.nodeType == 1)
                    siblings.push({
                        node: tmp,
                        baseTransform: getTransform(tmp),
                    });
                tmp = tmp.nextSibling;
            }
            return siblings;
        },
        animateToZero: function (callback, target) {
            // save, because this.target/container could change during animation
            target = target || _this.target;
            target.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.1s ease-out';
            target.node.style[transformJSPropertyName] = 'translate(0,0) ' + hwLayerMagicStyle + target.baseTransform.value;
            setTimeout(function () {
                target.node.style[transitionJSPropertyName] = '';
                target.node.style[transformJSPropertyName] = target.baseTransform.original;
                if (callback)
                    callback.call(_this, target);
            }, 101);
        },
        animateSwipe: function (callback) {
            var target = _this.target;
            var siblings = _this.getSiblings(target);
            var emptySpaceTransformStyle = 'translate(0,' + _this.target.height + 'px) ' + hwLayerMagicStyle + ' ';
            // FIXME: animate with real velocity
            target.node.style[transitionJSPropertyName] = 'all 0.1s linear';
            target.node.style[transformJSPropertyName] = ' translate(' + (_this.getTotalMovement().x > 0 ? '' : '-') + '100%,0) ' + hwLayerMagicStyle + target.baseTransform.value;
            setTimeout(function () {
                if (callback.call(_this, target)) {
                    siblings.forEach(function (o) {
                        o.node.style[transitionJSPropertyName] = '';
                        o.node.style[transformJSPropertyName] = emptySpaceTransformStyle + o.baseTransform.value;
                    });
                    setTimeout(function () {
                        siblings.forEach(function (o) {
                            o.node.style[transitionJSPropertyName] = transformCSSPropertyName + ' 0.1s ease-in-out';
                            o.node.style[transformJSPropertyName] = 'translate(0,0) ' + hwLayerMagicStyle + o.baseTransform.value;
                        });
                        setTimeout(function () {
                            siblings.forEach(function (o) {
                                o.node.style[transitionJSPropertyName] = '';
                                o.node.style[transformJSPropertyName] = o.baseTransform.original;
                            });
                        }, 101);
                    }, 1);
                }
            }, 101);
        },
    };
    return Slip;
};
