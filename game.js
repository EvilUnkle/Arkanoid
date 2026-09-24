console.log('game.js загружен');
alert('game.js загружен');

document.addEventListener('DOMContentLoaded', function () {
    console.log('DOMContentLoaded');
    var btn = document.getElementById('start-btn');
    console.log('start-btn =', btn);
    if (btn) {
        btn.addEventListener('click', function () {
            alert('кнопка работает');
        });
    } else {
        alert('КНОПКА НЕ НАЙДЕНА');
    }
});