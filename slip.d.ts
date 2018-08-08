export interface ISlip extends IState, IDispatch, IMovement {
    (container: HTMLElement | null, options: IOptions): ISlip;

    options: IOptions;
    states: {reorder: string, swipe: string, idle: string, undecided: string};
    attach: (container: HTMLElement) => void;
    container: HTMLElement;
    latestPosition: IPosition;
    startPosition: IPosition;
    previousPosition: IPosition;
    animateSwipe: (callback: (target: ITarget) => void) => void | boolean;
    animateToZero: (callback?: (target: ITarget) => void, target?: ITarget) => void | boolean;
    getTotalMovement: () => IPosition;
    updateScrolling: () => void;
    target: ITarget;
    state: IState;
    detach: () => void;
    setChildNodesAriaRoles: () => void;
    unSetChildNodesAriaRoles: () => void;
    otherNodes: {node: Node & ChildNode, baseTransform: ITransform, pos: | EventTarget}[];
    findTargetNode: (targetNode: Node | null) => Node | null;
    mouseHandlersAttached: boolean;
    usingTouch: boolean;
    addMouseHandlers: () => void;
    canPreventScrolling: boolean;
    startAtPosition: (position: IPosition) => void;
    setTarget: (e: Event & {target: Node | EventTarget | null}) => boolean;
    getSiblings: (target: ITarget) => ISibling[];
    updatePosition: (e: MouseEvent | TouchEvent, position: IPosition) => void;
}

interface IDispatch {
    dispatch: (target: ITarget['node'] | ITarget, event: TEvent,
               move?: IMove) => void;
}

interface IMovement {
    getAbsoluteMovement: () => Required<IMove>;
}

export interface IOptions {
    keepSwipingPercent: number;
    minimumSwipeVelocity: number;
    minimumSwipeTime: number;
    ignoredElements: HTMLElement[];
    attach: ISlip['attach'];
}

export interface IPosition {
    x: number;
    y: number;
    time: number;
}

export interface IState {
    cancel: () => void;
    onTouchStart: () => void;
    onTouchMove: () => void;
    onTouchEnd: () => void;
    onMouseDown: () => void;
    onMouseMove: () => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    onSelection: () => void;
    onContainerFocus: () => void;
    onLeave: () => void;
    onEnd: () => void;
    onMove: () => void;
    setState: (state: ISlip['states']['idle']) => void;
    ctor: {new(): any};
    leaveState: () => void;
    allowTextSelection: boolean;
}

interface IStateSelected extends IMovement {
    removeMouseHandlers: () => void;
    usingTouch: boolean;
    target: ITarget | null;
    setState: (state: IStateSelected['states']['reorder']) => void;
    states: ISlip['states'];
    canPreventScrolling: boolean;
    container: HTMLElement;
}

export interface IStateIdle extends IStateSelected {

}

export interface IStateUndecided extends IStateSelected, IDispatch {
    target: ITarget;
}

export interface IStateReorder extends IStateUndecided, ISlip {

}

export interface ITarget {
    node: HTMLElement & {style: {willChange?: string;}};
    height?: number;
    originalTarget: ITarget;
    baseTransform: ITransform;
    scrollContainer: HTMLElement;
    origScrollTop: number;
    origScrollHeight: number;
}

export interface ISibling {
    node: HTMLElement;
    baseTransform: ITransform;
}

export interface ITransform {
    value: string;
    original: string;
}

interface IMove {
    directionX?: number;
    directionY?: number,
    x?: number;
    y?: number;
    originalIndex?: number;
    direction?: number;
    time?: number;
    spliceIndex?: number;
    insertBefore?: {node: Node & ChildNode, baseTransform: ITransform, pos: number};
}

type TEvent = 'beforewait' | 'beforereorder' | 'beforeswipe' | 'tap' | 'afterswipe'
    | 'animateswipe' | 'cancelswipe' | 'swipe' | 'reorder'
    | 'mouseleave' | 'mousemove' | 'mouseup' | 'blur';
