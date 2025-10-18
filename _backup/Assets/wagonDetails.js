var WagonDetails = pc.createScript('wagonDetails');

WagonDetails.attributes.add('wheelYOffset', {
    type: 'number',
    default: 1.0,
    description: 'The offset from the center of the wheel system to the bottom of the wheel'
});

WagonDetails.attributes.add('wheelXOffset', {
    type: 'number',
    default: 1.0,
    description: 'Distance between wheels'
});
