document.addEventListener('DOMContentLoaded', function () {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(button => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');

      // 1. Remove active class from all buttons and contents
      tabs.forEach(btn => btn.classList.remove('active'));
      contents.forEach(content => content.classList.remove('active'));

      // 2. Add active class to the clicked button and its target div
      button.classList.add('active');
      document.getElementById(targetId).classList.add('active');
    });
  });
});