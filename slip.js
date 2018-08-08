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
var Slip = /** @class */ (function () {
    function Slip(container, options) {
        this.container = container;
        this.options = options;
        this.state = undefined;
        this.usingTouch = false; // there's no good way to detect touchscreen preference other than receiving a touch event (really, trust me).
        this.mouseHandlersAttached = false;
        this.previousPosition = undefined; // x,y,time where the finger was ~100ms ago (for velocity calculation)
        this.accessibility = {
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
        this.damnYouChrome = /Chrome\/[3-5]/.test(navigator.userAgent); // For bugs that can't be programmatically detected :( Intended to catch all versions of Chrome 30-40
        this.needsBodyHandlerHack = this.damnYouChrome; // Otherwise I _sometimes_ don't get any touchstart events and only clicks instead.
        /* When dragging elements down in Chrome (tested 34-37) dragged element may appear below stationary elements.
           Looks like WebKit bug #61824, but iOS Safari doesn't have that problem. */
        this.compositorDoesNotOrderLayers = this.damnYouChrome;
        this.canPreventScrolling = false;
        this.transitionJSPropertyName = 'transition'.indexOf(this.testElementStyle.toString()) > -1 ? 'transition' : 'webkitTransition';
        this.transformJSPropertyName = 'transform'.indexOf(this.testElementStyle.toString()) > -1 ? 'transform' : 'webkitTransform';
        this.userSelectJSPropertyName = 'userSelect'.indexOf(this.testElementStyle.toString()) > -1 ? 'userSelect' : 'webkitUserSelect';
        // -webkit-mess
        this.testElementStyle = document.createElement('div').style;
        this.globalInstances = 0;
        this.attachedBodyHandlerHack = false;
        this.hwLayerMagicStyle = this.testElementStyle[this.transformJSPropertyName] ? 'translateZ(0) ' : '';
        this.hwTopLayerMagicStyle = this.testElementStyle[this.transformJSPropertyName] ? 'translateZ(1px) ' : '';
        this.transformCSSPropertyName = this.transformJSPropertyName === 'webkitTransform' ? '-webkit-transform' : 'transform';
        this.testElementStyle[this.transformJSPropertyName] = 'translateZ(0)';
        if ('string' === typeof container)
            this.container = document.querySelector(container);
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
        this.states = this._states();
        return this;
    }
    Slip.prototype.detach = function () {
        this.cancel();
        this.container.removeEventListener('mousedown', this.onMouseDown, false);
        this.container.removeEventListener('touchend', this.onTouchEnd, false);
        this.container.removeEventListener('touchmove', this.onTouchMove, false);
        this.container.removeEventListener('touchstart', this.onTouchStart, false);
        this.container.removeEventListener('touchcancel', this.cancel, false);
        document.removeEventListener('selectionchange', this.onSelection, false);
        if (false !== this.accessibility.container.tabIndex) {
            this.container.removeAttribute('tabIndex');
        }
        if (this.accessibility.container.ariaRole) {
            this.container.removeAttribute('aria-role');
        }
        this.unSetChildNodesAriaRoles();
        this.globalInstances--;
        if (!this.globalInstances && this.attachedBodyHandlerHack) {
            this.attachedBodyHandlerHack = false;
            document.body.removeEventListener('touchstart', Slip.nullHandler, false);
        }
    };
    Slip.prototype.attach = function (container) {
        this.globalInstances++;
        if (this.container)
            this.detach();
        // In some cases taps on list elements send *only* click events and no touch events. Spotted only in Chrome 32+
        // Having event listener on body seems to solve the issue (although AFAIK may disable smooth scrolling as a side-effect)
        if (!this.attachedBodyHandlerHack && this.needsBodyHandlerHack) {
            this.attachedBodyHandlerHack = true;
            document.body.addEventListener('touchstart', Slip.nullHandler, false);
        }
        this.container = container;
        // Accessibility
        if (false !== this.accessibility.container.tabIndex) {
            this.container.tabIndex = this.accessibility.container.tabIndex;
        }
        if (this.accessibility.container.ariaRole) {
            this.container.setAttribute('aria-role', this.accessibility.container.ariaRole);
        }
        this.setChildNodesAriaRoles();
        this.container.addEventListener('focus', this.onContainerFocus, false);
        this.otherNodes = [];
        // selection on iOS interferes with reordering
        document.addEventListener('selectionchange', this.onSelection, false);
        // cancel is called e.g. when iOS detects multitasking gesture
        this.container.addEventListener('touchcancel', this.cancel, false);
        this.container.addEventListener('touchstart', this.onTouchStart, false);
        this.container.addEventListener('touchmove', this.onTouchMove, false);
        this.container.addEventListener('touchend', this.onTouchEnd, false);
        this.container.addEventListener('mousedown', this.onMouseDown, false);
        // mousemove and mouseup are attached dynamically
    };
    Slip.prototype.setState = function (newStateCtor) {
        if (this.state) {
            if (this.state.ctor === newStateCtor)
                return;
            if (this.state.leaveState)
                this.state.leaveState.call(this);
        }
        // Must be re-entrant in case ctor changes state
        var prevState = this.state;
        var nextState = newStateCtor.call(this);
        if (this.state === prevState) {
            nextState.ctor = newStateCtor;
            this.state = nextState;
        }
    };
    Slip.prototype.setChildNodesAriaRoles = function () {
        var nodes = this.container.childNodes;
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType != 1)
                continue;
            if (this.accessibility.items.ariaRole) {
                nodes[i].setAttribute('aria-role', this.accessibility.items.ariaRole);
            }
            if (false !== this.accessibility.items.tabIndex) {
                nodes[i].tabIndex = this.accessibility.items.tabIndex;
            }
        }
    };
    Slip.prototype.unSetChildNodesAriaRoles = function () {
        var nodes = this.container.childNodes;
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType != 1)
                continue;
            if (this.accessibility.items.ariaRole) {
                nodes[i].removeAttribute('aria-role');
            }
            if (false !== this.accessibility.items.tabIndex) {
                nodes[i].removeAttribute('tabIndex');
            }
        }
    };
    Slip.prototype.setTarget = function (e) {
        var targetNode = this.findTargetNode(e.target);
        if (!targetNode) {
            this.setState(this.states.idle);
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
        this.target = {
            originalTarget: e.target,
            node: targetNode,
            scrollContainer: scrollContainer,
            origScrollTop: scrollContainer.scrollTop,
            origScrollHeight: scrollContainer.scrollHeight,
            baseTransform: this.getTransform(targetNode),
        };
        return true;
    };
    Slip.prototype.findTargetNode = function (targetNode) {
        while (targetNode && targetNode.parentNode !== this.container) {
            if (targetNode.parentNode != null)
                targetNode = targetNode.parentNode;
        }
        return targetNode;
    };
    Slip.prototype.onContainerFocus = function (e) {
        e.stopPropagation();
        this.setChildNodesAriaRoles();
    };
    Slip.prototype.getAbsoluteMovement = function () {
        var move = this.getTotalMovement();
        return {
            x: Math.abs(move.x),
            y: Math.abs(move.y),
            time: move.time,
            directionX: move.x < 0 ? 'left' : 'right',
            directionY: move.y < 0 ? 'up' : 'down',
        };
    };
    Slip.prototype.getTotalMovement = function () {
        var scrollOffset = this.target.scrollContainer.scrollTop - this.target.origScrollTop;
        return {
            x: this.latestPosition.x - this.startPosition.x,
            y: this.latestPosition.y - this.startPosition.y + scrollOffset,
            time: this.latestPosition.time - this.startPosition.time,
        };
    };
    Slip.prototype.onSelection = function (e) {
        e.stopPropagation();
        var isRelated = e.target === document || this.findTargetNode(e);
        var iOS = /(iPhone|iPad|iPod)/i.test(navigator.userAgent) && !/(Android|Windows)/i.test(navigator.userAgent);
        if (!isRelated)
            return;
        if (iOS) {
            // iOS doesn't allow selection to be prevented
            this.setState(this.states.idle);
        }
        else {
            if (!this.state.allowTextSelection) {
                e.preventDefault();
            }
        }
    };
    Slip.prototype.addMouseHandlers = function () {
        // unlike touch events, mousemove/up is not conveniently fired on the same element,
        // but I don't need to listen to unrelated events all the time
        if (!this.mouseHandlersAttached) {
            this.mouseHandlersAttached = true;
            document.documentElement.addEventListener('mouseleave', this.onMouseLeave, false);
            window.addEventListener('mousemove', this.onMouseMove, true);
            window.addEventListener('mouseup', this.onMouseUp, true);
            window.addEventListener('blur', this.cancel, false);
        }
    };
    Slip.prototype.removeMouseHandlers = function () {
        if (this.mouseHandlersAttached) {
            this.mouseHandlersAttached = false;
            document.documentElement.removeEventListener('mouseleave', this.onMouseLeave, false);
            window.removeEventListener('mousemove', this.onMouseMove, true);
            window.removeEventListener('mouseup', this.onMouseUp, true);
            window.removeEventListener('blur', this.cancel, false);
        }
    };
    Slip.prototype.onMouseLeave = function (e) {
        e.stopPropagation();
        if (this.usingTouch)
            return;
        if (e.target === document.documentElement || e.relatedTarget === document.documentElement) {
            if (this.state.onLeave) {
                this.state.onLeave.call(this);
            }
        }
    };
    Slip.prototype.onMouseDown = function (e) {
        e.stopPropagation();
        if (this.usingTouch || e.button != 0 || !this.setTarget(e))
            return;
        this.addMouseHandlers(); // mouseup, etc.
        this.canPreventScrolling = true; // or rather it doesn't apply to mouse
        this.startAtPosition({
            x: e.clientX,
            y: e.clientY,
            time: e.timeStamp,
        });
    };
    Slip.prototype.onTouchStart = function (e) {
        e.stopPropagation();
        this.usingTouch = true;
        this.canPreventScrolling = true;
        // This implementation cares only about single touch
        if (e.touches.length > 1) {
            this.setState(this.states.idle);
            return;
        }
        if (e.target != null && !this.setTarget(e))
            return;
        this.startAtPosition({
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: e.timeStamp,
        });
    };
    Slip.prototype.dispatch = function (targetNode, eventName, detail) {
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
    };
    Slip.prototype.startAtPosition = function (pos) {
        this.startPosition = this.previousPosition = this.latestPosition = pos;
        this.setState(this.states.undecided);
    };
    Slip.prototype.updatePosition = function (e, pos) {
        if (this.target == null) {
            return;
        }
        this.latestPosition = pos;
        if (this.state.onMove) {
            if (this.state.onMove.call(this) === false) {
                e.preventDefault();
            }
        }
        // sample latestPosition 100ms for velocity
        if (this.latestPosition.time - this.previousPosition.time > 100) {
            this.previousPosition = this.latestPosition;
        }
    };
    Slip.prototype.onMouseMove = function (e) {
        e.stopPropagation();
        this.updatePosition(e, {
            x: e.clientX,
            y: e.clientY,
            time: e.timeStamp,
        });
    };
    Slip.prototype.onTouchMove = function (e) {
        e.stopPropagation();
        this.updatePosition(e, {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: e.timeStamp,
        });
        // In Apple's touch model only the first move event after touchstart can prevent scrolling (and event.cancelable is broken)
        this.canPreventScrolling = false;
    };
    Slip.prototype.onMouseUp = function (e) {
        e.stopPropagation();
        if (this.usingTouch || e.button !== 0)
            return;
        if (this.state.onEnd && false === this.state.onEnd.call(this)) {
            e.preventDefault();
        }
    };
    Slip.prototype.onTouchEnd = function (e) {
        e.stopPropagation();
        if (e.touches.length > 1) {
            this.cancel();
        }
        else if (this.state.onEnd && false === this.state.onEnd.call(this)) {
            e.preventDefault();
        }
    };
    Slip.prototype.animateToZero = function (callback, target) {
        var _this = this;
        // save, because this.target/container could change during animation
        target = target || this.target;
        target.node.style[this.transitionJSPropertyName] = this.transformCSSPropertyName + ' 0.1s ease-out';
        target.node.style[this.transformJSPropertyName] = 'translate(0,0) ' + this.hwLayerMagicStyle + target.baseTransform.value;
        setTimeout(function () {
            if (target != null) {
                target.node.style[_this.transitionJSPropertyName] = '';
                target.node.style[_this.transformJSPropertyName] = target.baseTransform.original;
            }
            if (callback)
                callback.call(_this, target);
        }, 101);
    };
    Slip.prototype.getSiblings = function (target) {
        var siblings = [];
        var tmp = target.node.nextSibling;
        while (tmp) {
            if (tmp.nodeType == 1)
                siblings.push({
                    node: tmp,
                    baseTransform: this.getTransform(tmp),
                });
            tmp = tmp.nextSibling;
        }
        return siblings;
    };
    Slip.prototype.updateScrolling = function () {
        var triggerOffset = 40;
        var offset = 0;
        var scrollable = this.target.scrollContainer, containerRect = scrollable.getBoundingClientRect(), targetRect = this.target.node.getBoundingClientRect(), bottomOffset = Math.min(containerRect.bottom, window.innerHeight) - targetRect.bottom, topOffset = targetRect.top - Math.max(containerRect.top, 0), maxScrollTop = this.target.origScrollHeight - Math.min(scrollable.clientHeight, window.innerHeight);
        if (bottomOffset < triggerOffset) {
            offset = Math.min(triggerOffset, triggerOffset - bottomOffset);
        }
        else if (topOffset < triggerOffset) {
            offset = Math.max(-triggerOffset, topOffset - triggerOffset);
        }
        scrollable.scrollTop = Math.max(0, Math.min(maxScrollTop, scrollable.scrollTop + offset));
    };
    Slip.prototype.animateSwipe = function (callback) {
        var _this = this;
        var target = this.target;
        var siblings = this.getSiblings(target);
        var emptySpaceTransformStyle = 'translate(0,' + this.target.height + 'px) ' + this.hwLayerMagicStyle + ' ';
        // FIXME: animate with real velocity
        target.node.style[this.transitionJSPropertyName] = 'all 0.1s linear';
        target.node.style[this.transformJSPropertyName] = ' translate(' + (this.getTotalMovement().x > 0 ? '' : '-') + '100%,0) ' + this.hwLayerMagicStyle + target.baseTransform.value;
        setTimeout(function () {
            if (callback.call(_this, target)) {
                siblings.forEach(function (o) {
                    o.node.style[_this.transitionJSPropertyName] = '';
                    o.node.style[_this.transformJSPropertyName] = emptySpaceTransformStyle + o.baseTransform.value;
                });
                setTimeout(function () {
                    siblings.forEach(function (o) {
                        o.node.style[_this.transitionJSPropertyName] = _this.transformCSSPropertyName + ' 0.1s ease-in-out';
                        o.node.style[_this.transformJSPropertyName] = 'translate(0,0) ' + _this.hwLayerMagicStyle + o.baseTransform.value;
                    });
                    setTimeout(function () {
                        siblings.forEach(function (o) {
                            o.node.style[_this.transitionJSPropertyName] = '';
                            o.node.style[_this.transformJSPropertyName] = o.baseTransform.original;
                        });
                    }, 101);
                }, 1);
            }
        }, 101);
    };
    Slip.prototype._states = function () {
        var outer = this;
        return /** @class */ (function () {
            function class_1() {
            }
            /*
            init() {
                switch (this.state) {
                    case 'idle':
                        this.idle();
                        outer.usingTouch = false;

                        return {
                            allowTextSelection: true,
                        };
                }
            }*/
            class_1.idle = function () {
                outer.removeMouseHandlers();
                if (outer.target) {
                    outer.target.node.style.willChange = '';
                    delete outer.target;
                }
            };
            class_1.undecided = function () {
                outer.target.height = outer.target.node.offsetHeight;
                outer.target.node.style.willChange = outer.transformCSSPropertyName;
                outer.target.node.style[outer.transitionJSPropertyName] = '';
                var holdTimer = 0;
                if (!outer.dispatch(outer.target.originalTarget, 'beforewait')) {
                    if (outer.dispatch(outer.target.originalTarget, 'beforereorder')) {
                        outer.setState(outer.states.reorder);
                    }
                }
                else {
                    holdTimer = setTimeout(function () {
                        var move = outer.getAbsoluteMovement();
                        if (outer.canPreventScrolling && move.x < 15 && move.y < 25) {
                            if (outer.dispatch(outer.target.originalTarget, 'beforereorder')) {
                                outer.setState(outer.states.reorder);
                            }
                        }
                    }, 300);
                }
                return {
                    leaveState: function () { return clearTimeout(holdTimer); },
                    onMove: function () {
                        var move = outer.getAbsoluteMovement();
                        if (move.x > 20 && move.y < Math.max(100, outer.target.height || 0)) {
                            if (outer.dispatch(outer.target.originalTarget, 'beforeswipe', {
                                directionX: move.directionX,
                                directionY: move.directionY
                            })) {
                                outer.setState(outer.states.swipe);
                                return false;
                            }
                            else {
                                outer.setState(outer.states.idle);
                            }
                        }
                        if (move.y > 20) {
                            outer.setState(outer.states.idle);
                        }
                        // Chrome likes sideways scrolling :(
                        if (move.x > move.y * 1.2)
                            return false;
                    },
                    onLeave: function () { return outer.setState(outer.states.idle); },
                    onEnd: function () {
                        var allowDefault = outer.dispatch(outer.target.originalTarget, 'tap');
                        outer.setState(outer.states.idle);
                        return allowDefault;
                    },
                };
            };
            class_1.swipe = function () {
                var swipeSuccess = false;
                var container = outer.container;
                var originalIndex = outer.findIndex(outer.target, outer.container.childNodes);
                container.classList.add('slip-swiping-container');
                var removeClass = function () { return container.classList.remove('slip-swiping-container'); };
                outer.target.height = outer.target.node.offsetHeight;
                return {
                    leaveState: function () {
                        if (swipeSuccess) {
                            outer.animateSwipe(function (target) {
                                target.node.style[outer.transformJSPropertyName] = target.baseTransform.original;
                                target.node.style[outer.transitionJSPropertyName] = '';
                                if (outer.dispatch(target.node, 'afterswipe')) {
                                    removeClass();
                                    return true;
                                }
                                else {
                                    outer.animateToZero(undefined, target);
                                }
                            });
                        }
                        else {
                            outer.animateToZero(removeClass);
                        }
                    },
                    onMove: function () {
                        var move = outer.getTotalMovement();
                        if (outer.target.height && Math.abs(move.y) < outer.target.height + 20) {
                            if (outer.dispatch(outer.target.node, 'animateswipe', {
                                x: move.x,
                                originalIndex: originalIndex
                            })) {
                                outer.target.node.style[outer.transformJSPropertyName] = 'translate(' + move.x + 'px,0) ' + outer.hwLayerMagicStyle + outer.target.baseTransform.value;
                            }
                            return false;
                        }
                        else {
                            outer.dispatch(outer.target.node, 'cancelswipe');
                            outer.setState(outer.states.idle);
                        }
                    },
                    onLeave: this.swipe().onEnd,
                    onEnd: function () {
                        var move = outer.getAbsoluteMovement();
                        var velocity = move.x / move.time;
                        // How far out has the item been swiped?
                        var swipedPercent = Math.abs((outer.startPosition.x - outer.previousPosition.x) / outer.container.clientWidth) * 100;
                        var swiped = (velocity > outer.options.minimumSwipeVelocity && move.time > outer.options.minimumSwipeTime) || (outer.options.keepSwipingPercent && swipedPercent > outer.options.keepSwipingPercent);
                        if (swiped) {
                            if (outer.dispatch(outer.target.node, 'swipe', {
                                direction: move.directionX,
                                originalIndex: originalIndex
                            })) {
                                swipeSuccess = true; // can't animate here, leaveState overrides anim
                            }
                        }
                        else {
                            outer.dispatch(outer.target.node, 'cancelswipe');
                        }
                        outer.setState(outer.states.idle);
                        return !swiped;
                    },
                };
            };
            class_1.reorder = function () {
                if (outer.target.node.focus && outer.accessibility.items.focus) {
                    outer.target.node.focus();
                }
                outer.target.height = outer.target.node.offsetHeight;
                var nodes;
                if (outer.options.ignoredElements.length) {
                    var container = outer.container;
                    var query_1 = container.tagName.toLowerCase();
                    if (container.getAttribute('id')) {
                        query_1 = '#' + container.getAttribute('id');
                    }
                    else if (container.classList.length) {
                        query_1 += '.' + container.getAttribute('class')
                            .replace(' ', '.');
                    }
                    query_1 += ' > ';
                    outer.options.ignoredElements.forEach(function (selector) {
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
                    nodes = outer.container.childNodes;
                }
                var originalIndex = outer.findIndex(outer.target, nodes);
                var mouseOutsideTimer;
                var zero = outer.target.node.offsetTop + outer.target.height / 2;
                var otherNodes = [];
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i].nodeType != 1 || nodes[i] === outer.target.node)
                        continue;
                    var t = nodes[i].offsetTop;
                    nodes[i].style[outer.transitionJSPropertyName] = outer.transformCSSPropertyName + ' 0.2s ease-in-out';
                    otherNodes.push({
                        node: nodes[i],
                        baseTransform: outer.getTransform(nodes[i]),
                        pos: t + (t < zero ? nodes[i].offsetHeight : 0) - zero,
                    });
                }
                outer.target.node.classList.add('slip-reordering');
                outer.target.node.style.zIndex = '99999';
                outer.target.node.style[outer.userSelectJSPropertyName] = 'none';
                if (outer.compositorDoesNotOrderLayers) {
                    // Chrome's compositor doesn't sort 2D layers
                    outer.container.style.webkitTransformStyle = 'preserve-3d';
                }
                var onMove = function () {
                    /*jshint validthis:true */
                    outer.updateScrolling();
                    if (mouseOutsideTimer) {
                        // don't care where the mouse is as long as it moves
                        clearTimeout(mouseOutsideTimer);
                        mouseOutsideTimer = null;
                    }
                    var move = outer.getTotalMovement();
                    outer.target.node.style[outer.transformJSPropertyName] = 'translate(0,' + move.y + 'px) ' + outer.hwTopLayerMagicStyle + outer.target.baseTransform.value;
                    var height = outer.target.height || 0;
                    otherNodes.forEach(function (o) {
                        var off = 0;
                        if (o.pos < 0 && move.y < 0 && o.pos > move.y) {
                            off = height;
                        }
                        else if (o.pos > 0 && move.y > 0 && o.pos < move.y) {
                            off = -height;
                        }
                        // FIXME: should change accelerated/non-accelerated state lazily
                        o.node.style[outer.transformJSPropertyName] = off ? 'translate(0,' + off + 'px) ' + outer.hwLayerMagicStyle + o.baseTransform.value : o.baseTransform.original;
                    });
                    return false;
                };
                onMove();
                return {
                    leaveState: function () {
                        if (mouseOutsideTimer)
                            clearTimeout(mouseOutsideTimer);
                        if (outer.compositorDoesNotOrderLayers) {
                            outer.container.style.webkitTransformStyle = '';
                        }
                        if (outer.container.focus && outer.accessibility.container.focus) {
                            outer.container.focus();
                        }
                        outer.target.node.classList.remove('slip-reordering');
                        outer.target.node.style[outer.userSelectJSPropertyName] = '';
                        outer.animateToZero(function (target) { return target.node.style.zIndex = ''; });
                        otherNodes.forEach(function (o) {
                            o.node.style[outer.transformJSPropertyName] = o.baseTransform.original;
                            o.node.style[outer.transitionJSPropertyName] = ''; // FIXME: animate to new position
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
                            outer.cancel();
                        }, 700);
                    },
                    onEnd: function () {
                        var move = outer.getTotalMovement();
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
                        outer.dispatch(outer.target.node, 'reorder', {
                            spliceIndex: spliceIndex,
                            originalIndex: originalIndex,
                            insertBefore: otherNodes[spliceIndex] ? otherNodes[spliceIndex].node : undefined,
                        });
                        outer.setState(outer.states.idle);
                        return false;
                    },
                };
            };
            return class_1;
        }());
    };
    Slip.prototype.getTransform = function (node) {
        var transform = node.style[this.transformJSPropertyName];
        if (transform) {
            return {
                value: transform,
                original: transform,
            };
        }
        if (window.getComputedStyle) {
            var style = window.getComputedStyle(node).getPropertyValue(this.transformCSSPropertyName);
            if (style && style !== 'none')
                return { value: style, original: '' };
        }
        return { value: '', original: '' };
    };
    /// states
    Slip.prototype.findIndex = function (target, nodes) {
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
    Slip.nullHandler = function () { };
    return Slip;
}());
exports.Slip = Slip;
