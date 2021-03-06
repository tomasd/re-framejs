'use strict';

import * as subs from 'reframe/subs.js';
import * as React from 'react';
import {shouldUpdate, shouldUpdateArgv} from 'reframe/shouldupdate';
import * as ratom from 'reframe/ratom';
import * as batching from 'reframe/batching';
import {isDebug, isTraceReact} from 'reframe/interop';
import {markRendered} from 'reframe/batching';
import createReactClass from 'create-react-class';

// export const pause$ = new Rx.BehaviorSubject(true);

// export function deref(rx, transform) {
//     let ttransform = transform || (a => a);
//     let subj = new Rx.BehaviorSubject();
//     rx.map(ttransform).subscribe(subj).dispose();
//     return subj.getValue();
// }

let data = {
    renderOrder: 0,
    toUpdate: []
};

function shouldUpdateByDerefed(watching) {
    for (let watch of watching) {
        if (watch.shouldUpdate()) {
            return true;
        }
    }
    return false;
}


export function render() {
    data.toUpdate.sort(([o1], [o2]) => o1 - o2);

    data.toUpdate.forEach(([_, forceUpdate]) => forceUpdate());
    data.toUpdate = [];
}
// subs.render$
//     .pausable(pause$)
//     .subscribe(render);

export function StatelessMixin(isArgv) {
    return {
        shouldComponentUpdate: function (nextProps, nextState) {
            const propsUpdate = isArgv ? shouldUpdateArgv(this.props.argv, nextProps.argv) : shouldUpdate(this.props, nextProps, ['ctx']);
            const stateUpdate = shouldUpdate(this.state, nextState);
            return propsUpdate || stateUpdate;
        },
        getDisplayName: function () {
            return this.constructor.displayName;
        },
        traceReact(message) {
            if (isTraceReact()) {
                console.debug(message, this.getDisplayName(), {
                    order: this.state.renderOrder,
                    render: this.state.renderCycle,
                    props: this.props, state: this.state
                });
            }
        },
        id() {
            return this.getDisplayName();
        }
    };
}

function S4() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
}

// Generate a pseudo-GUID by concatenating random hexadecimal.
function guid() {
    return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
}

class ReactViewDeref extends (ratom.Observable) {
    constructor(component, renderCycle, observable) {
        super('de');
        this._componentId = component.id();
        this._renderCycle = renderCycle;
        this._observable = observable;
        this._lastValue = observable.peekValue();
    }

    notify() {
        this._notifyObservers();
    }

    shouldDispose(renderCycle) {
        return renderCycle > this._renderCycle;
    }

    dispose() {
        super.dispose();
        this._observable.dispose();
    }

    deref() {
        return this._lastValue;
    }

    shouldUpdate() {
        return this._observable.isChanged(this._lastValue);
    }
}


export function SubscriptionMixin(isArgv) {
    return {
        derefSub(subVec, transform) {
            return ratom.deref(subs.subscribe(subVec), transform);
        },
        getDisplayName: function () {
            return this.constructor.displayName;
        },
        getInitialState: function () {
            return {
                watching: new Set(),
                renderOrder: data.renderOrder++,
                renderCycle: 0
            };
        },
        observe: function (watch) {
            if (!this.state.watching.has(watch)) {
                const deref = new ReactViewDeref(this, this.state.renderCycle, watch);
                this.state.watching.add(deref);
                watch.subscribe(deref);
                deref.subscribe(this);
                watch.unsubscribe(this);
            }
        },
        id() {
            return this.getDisplayName();
        },
        // unobserve: function(observable) {
        //     this.state.watching.delete(observable);
        // },
        notify: function (dispose) {
            this.traceReact('Notify');
            batching.queueRender(this);
        },
        tryForceUpdate: function () {
            if (shouldUpdateByDerefed(this.state.watching)) {
                this.traceReact('Force update');
                // console.log('Force update', obj.getDisplayName());
                this.forceUpdate();
            }
        },
        shouldComponentUpdate: function (nextProps, nextState) {
            let updateByProps = isArgv ? shouldUpdateArgv(this.props.argv, nextProps.argv) : shouldUpdate(this.props, nextProps, ['ctx']),
                updateByState = shouldUpdate(this.state, nextState, ['watching', 'renderOrder', 'renderCycle']);

            return updateByProps || updateByState;
        },
        deref: function (rx, aTransform, aId) {
            return ratom.deref(rx, aTransform);
        },
        unsubscribe: function () {
            this.state.watching.forEach(watch => {
                watch.unsubscribe(this);
                watch.dispose()
            });
        },
        componentWillUpdate: function () {
            // console.log('Rendering', this.getDisplayName());
            this.state.renderCycle++;
            // this.unsubscribe();
        },
        componentDidUpdate: function () {
            for (let watch of this.state.watching) {
                // console.log(watch._observable.id(), this.state.renderCycle, watch.shouldDispose(this.state.renderCycle), watch);
                if (watch.shouldDispose(this.state.renderCycle)) {
                    this.state.watching.delete(watch);
                    watch.unsubscribe(this);
                    watch.dispose();
                }
            }
        },
        componentWillUnmount: function () {
            markRendered(this);
            this.unsubscribe();
        },
        traceReact(message) {
            if (isTraceReact()) {
                console.debug(message, this.getDisplayName(), {
                    order: this.state.renderOrder,
                    render: this.state.renderCycle,
                    props: this.props, state: this.state
                });
            }
        }
    };
}

function createComponentObj(mixins, args) {
    let componentObj;
    switch (args.length) {
        case 2:
            if (typeof args[1].prototype === 'undefined') {
                args[1].mixins = mixins;
                componentObj = args[1];
            } else {
                componentObj = {
                    mixins: mixins,
                    render: args[1]
                };
            }
            break;
        case 3:
            if (typeof args[2].prototype === 'undefined') {
                // it's an object
                args[2].mixins = mixins.concat(args[1]);
                componentObj = args[2];
            } else {
                // it's a render function
                componentObj = {
                    mixins: mixins.concat(args[1]),
                    render: args[2]
                };
            }
            break;
        default :
            throw new Error('Expected 2 or 3 arguments, got ' + args.length);
    }
    componentObj.displayName = args[0];
    return componentObj;
}

function propsView(mixin, args) {
    let componentObj = createComponentObj(mixin, args);
    let oldRender = componentObj.render;
    componentObj.render = function () {
        this.traceReact('Render');
        markRendered(this);
        return ratom.runInCtx(this, () => oldRender.call(this, this.props));
    };

    let component = createReactClass(componentObj);
    let factory = React.createFactory(component);
    return function (props) {
        return factory(props);
    };
}

function createComponent(mixin, args) {
    let componentObj = createComponentObj(mixin, args);
    let oldRender = componentObj.render;
    componentObj.render = function () {
        this.traceReact('Render');
        markRendered(this);
        return ratom.runInCtx(this, () => oldRender.call(this, this.props));
    };

    return createReactClass(componentObj);
}

function createFactory(mixin, args) {
    const component = createComponent(mixin, args);
    let factory = React.createFactory(component);
    return factory;
}

export function uix(name, mixin, clazz) {
    return createComponent([SubscriptionMixin(false)], arguments);
}

export function ui(name, mixin, clazz) {
    return createFactory([SubscriptionMixin(false)], arguments);
}

function vectorView(mixin, args) {
    let componentObj = createComponentObj(mixin, args);
    let oldRender = componentObj.render;
    componentObj.render = function () {
        this.traceReact('Render');
        markRendered(this);
        return ratom.runInCtx(this, () => oldRender.apply(this, this.props.argv));
    };
    let component = createReactClass(componentObj);
    let factory = React.createFactory(component);

    return function () {
        return factory({argv: Array.prototype.slice.call(arguments)});
    };
}

export function viewP() {
    return propsView([StatelessMixin(false)], arguments);
}

export function viewV() {
    return vectorView([StatelessMixin(true)], arguments);
}

export function viewSP() {
    return propsView([SubscriptionMixin(false)], arguments);
}

export function viewSV() {
    return vectorView([SubscriptionMixin(true)], arguments);
}
